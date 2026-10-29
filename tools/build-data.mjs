// Converts the Ganjoor SQLite database (db/ganjoor.s3db, ~340 MB) into Doost's compact
// offline format in www/data. Same ideas as Yaad: small always-loaded catalog, verse text in
// gzip'd single-byte-charset blocks fetched on demand, prefix-sharded inverted index.
//
// Output:
//   meta.json          counts, block table, shard table, charset, stopwords, build id
//   catalog.bin        gzip text, three sections separated by \x1d:
//                        poets  "id \t name \t rootCat \t firstPoem \t poemCount" per line (by id)
//                        cats   "id \t poetIdx \t parentIdx \t firstPoem \t poemCount \t title" per line
//                        titles one poem title per line, in reading order
//   poems.bin          gzip: Uint32[poems] Ganjoor poem ids, then Uint16[poems] category index
//   bios.bin           gzip text: poet descriptions, one per line (same order as poets)
//   v/<n>.bin          verse blocks; one record per poem, records joined by \x1e,
//                      verses joined by \n, each verse = position char (\x10 + position + 1) + text
//   t/<n>.bin          inverted index (token -> poem indexes), shards grouped by token prefix
//
// "Poem index" = position in reading order: poets by Ganjoor id (≈ prominence), then each
// poet's category tree depth-first, poems by id. Each poet's poems are one contiguous range.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { tokenize } from '../www/js/normalize.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(ROOT, 'db', 'ganjoor.s3db');
const OUT = path.join(ROOT, 'www', 'data');
const BLOCK_BYTES = 64 * 1024;
const SHARD_BUDGET = 160 * 1024;
const STOP_DF = +(process.env.STOP_DF || 0.1); // tokens in more poems than this fraction are not indexed

const gz = (buf) => zlib.gzipSync(buf, { level: 9 });
const write = (rel, buf) => {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buf);
  return buf.length;
};
const clean = (s) => String(s ?? '').replace(/[\r\n\t\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim();
function varint(arr, n) {
  while (n >= 0x80) {
    arr.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  arr.push(n);
}

console.time('read');
const db = new DatabaseSync(DB, { readOnly: true });
const poetRows = db.prepare('SELECT id, name, cat_id, description FROM poet ORDER BY id').all();
const catRows = db.prepare('SELECT id, poet_id, text, parent_id FROM cat ORDER BY id').all();
const poemRows = db.prepare('SELECT id, cat_id, title FROM poem ORDER BY id').all();
console.timeEnd('read');

// ---------------------------------------------------------------------------
// Reading order.
const catsById = new Map(catRows.map((c) => [c.id, { ...c, children: [], poems: [] }]));
for (const c of catsById.values()) catsById.get(c.parent_id)?.children.push(c);
for (const p of poemRows) catsById.get(p.cat_id)?.poems.push(p);

const poets = [];
const cats = []; // in DFS order
const poems = []; // reading order
function visit(cat, poetIdx, parentIdx) {
  const idx = cats.length;
  const node = { id: cat.id, poetIdx, parentIdx, title: clean(cat.text), firstPoem: poems.length, poemCount: 0 };
  cats.push(node);
  for (const p of cat.poems) poems.push({ id: p.id, title: clean(p.title), catIdx: idx });
  for (const ch of cat.children) visit(ch, poetIdx, idx);
  node.poemCount = poems.length - node.firstPoem; // includes sub-categories
  return idx;
}
for (const pr of poetRows) {
  const root = catsById.get(pr.cat_id);
  if (!root) continue;
  const poetIdx = poets.length;
  const poet = { id: pr.id, name: clean(pr.name), bio: clean(pr.description), firstPoem: poems.length };
  poets.push(poet);
  poet.rootCat = visit(root, poetIdx, -1);
  poet.poemCount = poems.length - poet.firstPoem;
}
console.log('poets', poets.length, 'cats', cats.length, 'poems', poems.length, 'of', poemRows.length);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const catalog = [
  poets.map((p) => [p.id, p.name, p.rootCat, p.firstPoem, p.poemCount].join('\t')).join('\n'),
  cats.map((c) => [c.id, c.poetIdx, c.parentIdx, c.firstPoem, c.poemCount, c.title].join('\t')).join('\n'),
  poems.map((p) => p.title).join('\n'),
].join('\x1d');
const catalogBytes = write('catalog.bin', gz(Buffer.from(catalog, 'utf8')));
const ids = new Uint32Array(poems.map((p) => p.id));
const catIdx = new Uint16Array(poems.map((p) => p.catIdx));
const poemsBytes = write('poems.bin', gz(Buffer.concat([Buffer.from(ids.buffer), Buffer.from(catIdx.buffer)])));
const biosBytes = write('bios.bin', gz(Buffer.from(poets.map((p) => p.bio).join('\n'), 'utf8')));

// ---------------------------------------------------------------------------
// Verses.
console.time('verses');
const verseStmt = db.prepare('SELECT poem_id, position, text FROM verse ORDER BY poem_id, vorder');
const versesByPoem = new Map();
for (const v of verseStmt.iterate()) {
  let arr = versesByPoem.get(v.poem_id);
  if (!arr) versesByPoem.set(v.poem_id, (arr = []));
  const pos = Math.max(-1, Math.min(14, v.position ?? 0));
  arr.push(String.fromCharCode(0x10 + pos + 1) + clean(v.text));
}
const records = poems.map((p) => (versesByPoem.get(p.id) || []).join('\n'));
versesByPoem.clear();
console.timeEnd('verses');

const freq = new Map([['\x1e', Infinity]]);
for (const rec of records) for (const ch of rec) freq.set(ch, (freq.get(ch) || 0) + 1);
const charset = [...freq].sort((a, b) => b[1] - a[1]).slice(0, 255).map(([c]) => c);
const charIndex = new Map(charset.map((c, i) => [c, i]));
const blockStarts = [];
let block = [];
let rawBytes = 0;
let verseBytes = 0;
const flush = () => {
  if (!block.length) return;
  rawBytes += block.length;
  verseBytes += write(`v/${blockStarts.length - 1}.bin`, gz(Buffer.from(block)));
  block = [];
};
records.forEach((rec, i) => {
  if (!block.length) blockStarts.push(i);
  else block.push(charIndex.get('\x1e'));
  for (const ch of rec) {
    const k = charIndex.get(ch);
    if (k !== undefined) block.push(k);
    else {
      const cp = ch.codePointAt(0);
      block.push(255, cp >> 16, (cp >> 8) & 255, cp & 255);
    }
  }
  if (block.length >= BLOCK_BYTES) flush();
});
flush();

// ---------------------------------------------------------------------------
// Inverted index: token -> sorted poem indexes (delta varint). Results are ranked by reading
// order (famous poets first), so no per-posting score is needed.
console.time('index');
const postings = new Map();
records.forEach((rec, i) => {
  const seen = new Set(tokenize(rec.replace(/[\x10-\x1f]/g, ' ')));
  for (const t of seen) {
    let arr = postings.get(t);
    if (!arr) postings.set(t, (arr = []));
    arr.push(i);
  }
});
const stop = [...postings].filter(([, a]) => a.length > poems.length * STOP_DF).map(([t]) => t);
for (const t of stop) postings.delete(t);
console.log('vocabulary', postings.size, 'stopwords', stop.length);

const enc = new TextEncoder();
const encoded = [...postings.keys()].sort().map((t) => {
  const arr = postings.get(t);
  const body = [];
  let prev = 0;
  for (const i of arr) {
    varint(body, i - prev);
    prev = i;
  }
  return { t, tb: enc.encode(t), body, count: arr.length };
});
const sizeOf = (e) => e.tb.length + e.body.length + 8;
const groups = [];
function partition(from, to, prefix) {
  let size = 0;
  for (let i = from; i < to; i++) size += sizeOf(encoded[i]);
  if (size <= SHARD_BUDGET || to - from <= 1) return void groups.push({ key: prefix, from, to, size });
  const depth = prefix.length;
  let i = from;
  if (encoded[i].t.length === depth) {
    groups.push({ key: prefix, from: i, to: i + 1, size: sizeOf(encoded[i]) });
    i++;
  }
  while (i < to) {
    const c = encoded[i].t[depth];
    let j = i;
    while (j < to && encoded[j].t[depth] === c) j++;
    partition(i, j, prefix + c);
    i = j;
  }
}
partition(0, encoded.length, '');
const shardKeys = [];
let shardCount = 0;
let indexBytes = 0;
let postingCount = 0;
for (let g = 0; g < groups.length; ) {
  const members = [];
  let size = 0;
  while (g < groups.length && (!members.length || size + groups[g].size <= SHARD_BUDGET)) {
    size += groups[g].size;
    members.push(groups[g++]);
  }
  const head = [];
  const body = [];
  varint(head, members.reduce((a, m) => a + m.to - m.from, 0));
  for (const m of members) {
    shardKeys.push([m.key, shardCount]);
    for (let i = m.from; i < m.to; i++) {
      const e = encoded[i];
      varint(head, e.tb.length);
      for (const x of e.tb) head.push(x);
      varint(head, e.count);
      varint(head, e.body.length);
      for (const x of e.body) body.push(x);
      postingCount += e.count;
    }
  }
  indexBytes += write(`t/${shardCount++}.bin`, gz(Buffer.concat([Buffer.from(head), Buffer.from(body)])));
}
console.timeEnd('index');

write(
  'meta.json',
  Buffer.from(
    JSON.stringify({
      version: 1,
      build: Date.now().toString(36),
      poets: poets.length,
      cats: cats.length,
      poems: poems.length,
      verses: records.reduce((a, r) => a + (r ? r.split('\n').length : 0), 0),
      blockStarts,
      shards: shardCount,
      shardKeys,
      stopwords: stop,
      charset: charset.join(''),
    }),
  ),
);

const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
console.log({
  blocks: blockStarts.length,
  rawVerses: mb(rawBytes),
  verses: mb(verseBytes),
  catalog: mb(catalogBytes + poemsBytes),
  bios: mb(biosBytes),
  postings: postingCount,
  shards: shardCount,
  index: mb(indexBytes),
  total: mb(verseBytes + catalogBytes + poemsBytes + biosBytes + indexBytes),
});
