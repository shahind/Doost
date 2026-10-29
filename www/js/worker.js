// Doost data worker: owns the catalog, verse blocks and full-text index so the UI thread
// never blocks. See tools/build-data.mjs for the file formats.
import { normalizeCompact, normalizeSpaced, tokenize, findMatches } from './normalize.js';

const DATA = new URL('../data/', import.meta.url);
const BLOCK_CACHE = 48;
const SHARD_CACHE = 48;
const PAGE_HITS = 40; // verse hits per page
const PAGE_MS = 120; // time budget per page
const MAX_EXPANSIONS = 400; // prefix expansions of the last query word
const LIST_LIMIT = 60; // title / category / poet results

let meta;
let charTable;
let stop;
let poets; // [{ idx, id, name, rootCat, firstPoem, poemCount }]
let cats; // [{ idx, id, poetIdx, parentIdx, firstPoem, poemCount, title, children: [] }]
let titles; // poem titles in reading order
let poemIds; // Uint32Array Ganjoor ids
let poemCat; // Uint16Array category index
let idToIdx;
let titleList; // compact searchable list of poem titles
let catList; // compact searchable list of category titles
const blockCache = new Map();
const shardCache = new Map();
const utf8 = new TextDecoder();

// ---------------------------------------------------------------------------
// Loading

async function gunzipBytes(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] !== 0x1f || u8[1] !== 0x8b) return u8; // already decoded by the transport
  if (typeof DecompressionStream === 'function') {
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const { gunzip } = await import('./inflate.js');
  return gunzip(u8);
}

async function fetchBin(path) {
  // ?v=<build> keeps HTTP/service-worker caches consistent across data rebuilds.
  const res = await fetch(new URL(`${path}?v=${meta.build}`, DATA));
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return gunzipBytes(await res.arrayBuffer());
}

// Searchable list: one compact normalized key per line, with word-start flags.
function buildList(lines) {
  const keys = lines.map((l) => normalizeCompact(l));
  const spaced = lines.map((l) => normalizeSpaced(l));
  let compact = '\n';
  const lineStart = new Uint32Array(lines.length + 1);
  const boundary = [];
  boundary.push(0);
  for (let i = 0; i < lines.length; i++) {
    lineStart[i] = compact.length;
    let ws = true;
    for (const ch of spaced[i]) {
      if (ch === ' ') {
        ws = true;
        continue;
      }
      boundary.push(ws ? 1 : 0);
      ws = false;
    }
    compact += keys[i] + '\n';
    boundary.push(0);
  }
  lineStart[lines.length] = compact.length;
  return { compact, lineStart, boundary: Uint8Array.from(boundary), count: lines.length };
}

function lineOf(list, pos) {
  let lo = 0;
  let hi = list.count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list.lineStart[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Lines containing q at a word start: exact matches, then prefixes, then the rest.
function scanList(list, q, accept, limit) {
  const tiers = [[], [], []];
  let total = 0;
  for (let pos = list.compact.indexOf(q); pos !== -1; ) {
    const line = lineOf(list, pos);
    const start = list.lineStart[line];
    const end = list.lineStart[line + 1] - 1;
    let ok = false;
    for (let p = pos; p !== -1 && p < end; p = list.compact.indexOf(q, p + 1)) {
      if (list.boundary[p]) {
        ok = true;
        break;
      }
    }
    if (ok && accept(line)) {
      total++;
      const t = pos === start ? (end - start === q.length ? 0 : 1) : 2;
      if (tiers[t].length < limit) tiers[t].push(line);
    }
    pos = list.compact.indexOf(q, end);
  }
  return { lines: tiers.flat().slice(0, limit), total };
}

async function init() {
  meta = await fetch(new URL('meta.json', DATA), { cache: 'no-cache' }).then((r) => r.json());
  const [cat, pm] = await Promise.all([fetchBin('catalog.txt'), fetchBin('poems.txt')]);
  charTable = new Uint16Array(256);
  for (let i = 0; i < meta.charset.length; i++) charTable[i] = meta.charset.charCodeAt(i);
  stop = new Set(meta.stopwords);
  const [poetText, catText, titleText] = utf8.decode(cat).split('\x1d');
  poets = poetText.split('\n').map((l, idx) => {
    const [id, name, rootCat, firstPoem, poemCount] = l.split('\t');
    return { idx, id: +id, name, rootCat: +rootCat, firstPoem: +firstPoem, poemCount: +poemCount };
  });
  cats = catText.split('\n').map((l, idx) => {
    const [id, poetIdx, parentIdx, firstPoem, poemCount, title] = l.split('\t');
    return { idx, id: +id, poetIdx: +poetIdx, parentIdx: +parentIdx, firstPoem: +firstPoem, poemCount: +poemCount, title, children: [] };
  });
  for (const c of cats) if (c.parentIdx >= 0) cats[c.parentIdx].children.push(c.idx);
  titles = titleText.split('\n');
  const n = titles.length;
  poemIds = new Uint32Array(pm.buffer.slice(pm.byteOffset, pm.byteOffset + n * 4));
  poemCat = new Uint16Array(pm.buffer.slice(pm.byteOffset + n * 4, pm.byteOffset + n * 6));
  return {
    poets,
    cats: cats.map(({ idx, id, poetIdx, parentIdx, firstPoem, poemCount, title, children }) => ({
      idx, id, poetIdx, parentIdx, firstPoem, poemCount, title, children,
    })),
    poems: n,
    verses: meta.verses,
    build: meta.build,
  };
}

// ---------------------------------------------------------------------------
// Verse blocks

function decodeBlock(bytes) {
  const out = new Uint16Array(bytes.length);
  let o = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b !== 255) out[o++] = charTable[b];
    else {
      const cp = (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3];
      i += 3;
      if (cp > 0xffff) {
        const v = cp - 0x10000;
        out[o++] = 0xd800 + (v >> 10);
        out[o++] = 0xdc00 + (v & 0x3ff);
      } else out[o++] = cp;
    }
  }
  let s = '';
  for (let i = 0; i < o; i += 8192) s += String.fromCharCode.apply(null, out.subarray(i, Math.min(o, i + 8192)));
  return s.split('\x1e');
}

function blockOf(i) {
  const starts = meta.blockStarts;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= i) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

async function loadBlock(b) {
  let entry = blockCache.get(b);
  if (entry) {
    blockCache.delete(b);
    blockCache.set(b, entry);
    return entry;
  }
  entry = fetchBin(`v/${b}.txt`).then(decodeBlock);
  blockCache.set(b, entry);
  if (blockCache.size > BLOCK_CACHE) blockCache.delete(blockCache.keys().next().value);
  try {
    return await entry;
  } catch (e) {
    blockCache.delete(b);
    throw e;
  }
}

// Verses of a poem as [position, text] pairs.
async function versesOf(i) {
  const b = blockOf(i);
  const rec = (await loadBlock(b))[i - meta.blockStarts[b]];
  if (!rec) return [];
  return rec.split('\n').map((v) => [v.charCodeAt(0) - 0x11, v.slice(1)]);
}

const poetOfPoem = (i) => cats[poemCat[i]].poetIdx;
const poemInfo = (i) => ({ idx: i, id: poemIds[i], title: titles[i], catIdx: poemCat[i], poetIdx: poetOfPoem(i) });

function resolveId(id) {
  if (!idToIdx) {
    idToIdx = new Map();
    for (let i = 0; i < poemIds.length; i++) idToIdx.set(poemIds[i], i);
  }
  return idToIdx.get(+id) ?? -1;
}

// Poems directly inside a category (not in its sub-categories): the head of its range.
function ownPoems(catIdx) {
  const c = cats[catIdx];
  const out = [];
  for (let i = c.firstPoem; i < c.firstPoem + c.poemCount && poemCat[i] === catIdx; i++) out.push({ idx: i, id: poemIds[i], title: titles[i] });
  return out;
}

// ---------------------------------------------------------------------------
// Full-text index

let shardKeyMap;
let shardKeyList;

function readVarint(buf, st) {
  let x = 0;
  let shift = 0;
  let b;
  do {
    b = buf[st.p++];
    x += (b & 0x7f) * 2 ** shift;
    shift += 7;
  } while (b & 0x80);
  return x;
}

async function loadShard(s) {
  let entry = shardCache.get(s);
  if (entry) {
    shardCache.delete(s);
    shardCache.set(s, entry);
    return entry;
  }
  entry = fetchBin(`t/${s}.txt`).then((buf) => {
    const st = { p: 0 };
    const n = readVarint(buf, st);
    const heads = [];
    for (let i = 0; i < n; i++) {
      const len = readVarint(buf, st);
      const token = utf8.decode(buf.subarray(st.p, st.p + len));
      st.p += len;
      heads.push({ token, count: readVarint(buf, st), bytes: readVarint(buf, st), off: 0 });
    }
    const dict = new Map();
    let off = st.p;
    for (const h of heads) {
      h.off = off;
      off += h.bytes;
      dict.set(h.token, h);
    }
    return { buf, dict, heads };
  });
  shardCache.set(s, entry);
  if (shardCache.size > SHARD_CACHE) shardCache.delete(shardCache.keys().next().value);
  return entry;
}

function shardsFor(token, prefix) {
  if (!shardKeyMap) {
    shardKeyMap = new Map(meta.shardKeys);
    shardKeyList = meta.shardKeys.map((k) => k[0]).sort();
  }
  const out = new Set();
  for (let l = token.length; l >= 0; l--) {
    const s = shardKeyMap.get(token.slice(0, l));
    if (s !== undefined) {
      out.add(s);
      break;
    }
  }
  if (prefix) {
    let lo = 0;
    let hi = shardKeyList.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (shardKeyList[mid] < token) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < shardKeyList.length && shardKeyList[i].startsWith(token) && out.size < 10; i++) {
      out.add(shardKeyMap.get(shardKeyList[i]));
    }
  }
  return [...out];
}

function decodePostings(shard, h) {
  const out = new Uint32Array(h.count);
  const st = { p: h.off };
  let prev = 0;
  for (let i = 0; i < h.count; i++) out[i] = prev += readVarint(shard.buf, st);
  return out;
}

// Sorted poem indexes containing `token` (or, with prefix, any word starting with it).
async function postingsFor(token, prefix) {
  const shards = await Promise.all(shardsFor(token, prefix).map(loadShard));
  const lists = [];
  const exp = [];
  for (const sh of shards) {
    const e = sh.dict.get(token);
    if (e) lists.push(decodePostings(sh, e));
    if (prefix) for (const h of sh.heads) if (h.token !== token && h.token.startsWith(token)) exp.push({ sh, h });
  }
  exp.sort((a, b) => b.h.count - a.h.count);
  for (const x of exp.slice(0, MAX_EXPANSIONS)) lists.push(decodePostings(x.sh, x.h));
  if (lists.length <= 1) return lists[0] || new Uint32Array(0);
  const all = new Uint32Array(lists.reduce((a, l) => a + l.length, 0));
  let o = 0;
  for (const l of lists) {
    all.set(l, o);
    o += l.length;
  }
  all.sort();
  let w = 0;
  for (let i = 0; i < all.length; i++) if (i === 0 || all[i] !== all[i - 1]) all[w++] = all[i];
  return all.subarray(0, w);
}

function intersect(a, b) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] < b[j]) i++;
    else if (a[i] > b[j]) j++;
    else {
      out.push(a[i]);
      i++;
      j++;
    }
  }
  return Uint32Array.from(out);
}

function scopeRange(scope) {
  if (scope && scope.cat != null) return [cats[scope.cat].firstPoem, cats[scope.cat].firstPoem + cats[scope.cat].poemCount];
  if (scope && scope.poet != null) return [poets[scope.poet].firstPoem, poets[scope.poet].firstPoem + poets[scope.poet].poemCount];
  return [0, titles.length];
}

// Candidate poems for a verse query, cached for paging.
let candCache = { key: '', list: null };
async function candidates(q, scope) {
  const key = q + '|' + JSON.stringify(scope || {});
  if (candCache.key === key) return candCache.list;
  const words = normalizeSpaced(q).split(' ').filter(Boolean);
  // Every word but the last is complete; the last may still be typed (prefix).
  const usable = words
    .map((w, i) => ({ w, prefix: i === words.length - 1 }))
    // Stop-words aren't indexed, so they can't narrow the candidates (even as a prefix: the
    // expansion would miss poems containing just the word). The phrase check enforces them.
    .filter(({ w }) => w.length > 1 && !stop.has(w));
  let list = null;
  if (usable.length) {
    const lists = await Promise.all(usable.map(({ w, prefix }) => postingsFor(w, prefix)));
    lists.sort((a, b) => a.length - b.length);
    list = lists[0];
    for (let i = 1; i < lists.length && list.length; i++) list = intersect(list, lists[i]);
  } else if (normalizeCompact(q).length >= 2) {
    // Only very common words («دل», «یک»…): they match almost every poem, so scanning in
    // reading order with the phrase check finds results immediately.
    const [from, to] = scopeRange(scope);
    list = new Uint32Array(to - from);
    for (let i = 0; i < list.length; i++) list[i] = from + i;
  }
  if (list) {
    const [from, to] = scopeRange(scope);
    if (from > 0 || to < titles.length) list = list.filter((i) => i >= from && i < to);
  }
  candCache = { key, list };
  return list;
}

// Long prose lines are shown as a window around the first match.
function clip(text, cq) {
  if (text.length <= 220) return text;
  const m = findMatches(text, cq, 1)[0];
  if (!m) return text.slice(0, 200) + ' …';
  let from = text.lastIndexOf(' ', Math.max(0, m[0] - 80));
  from = from < 0 ? 0 : from + 1;
  let to = text.indexOf(' ', Math.min(text.length, m[1] + 100));
  if (to < 0) to = text.length;
  return (from > 0 ? '… ' : '') + text.slice(from, to) + (to < text.length ? ' …' : '');
}

async function searchVerses(q, scope, cursor = 0) {
  const t0 = performance.now();
  const cq = normalizeCompact(q);
  const list = await candidates(q, scope);
  if (!list) return { hits: [], cursor: -1, candidates: 0, tooCommon: cq.length > 0 };
  const hits = [];
  let i = cursor;
  for (; i < list.length && hits.length < PAGE_HITS; i++) {
    const elapsed = performance.now() - t0;
    if (i > cursor && ((hits.length && elapsed > PAGE_MS) || elapsed > 2000)) break;
    const p = list[i];
    const vs = await versesOf(p);
    for (let k = 0; k < vs.length && hits.length < PAGE_HITS + 20; k++) {
      if (!findMatches(vs[k][1], cq, 1).length) continue;
      // Show the whole beyt: a first half-line (0) pairs with the next (1) and vice versa.
      let from = k;
      let to = k;
      if (vs[k][0] === 0 && vs[k + 1]?.[0] === 1) to = k + 1;
      else if (vs[k][0] === 1 && vs[k - 1]?.[0] === 0) from = k - 1;
      hits.push({ ...poemInfo(p), verse: from, lines: vs.slice(from, to + 1).map((v) => clip(v[1], cq)) });
      if (to > k) k = to; // don't report the same beyt twice
    }
  }
  return { hits, cursor: i < list.length ? i : -1, candidates: list.length, scanned: i, ms: performance.now() - t0 };
}

function searchLists(q, scope) {
  const cq = normalizeCompact(q);
  if (!cq) return { poets: [], cats: [], poems: [], poemTotal: 0 };
  titleList ??= buildList(titles);
  catList ??= buildList(cats.map((c) => c.title));
  const [from, to] = scopeRange(scope);
  const poetHits = scope && (scope.cat != null || scope.poet != null)
    ? []
    : poets.filter((p) => findMatches(p.name, cq, 1).length).slice(0, 12);
  const catRes = scanList(catList, cq, (c) => cats[c].parentIdx >= 0 && cats[c].firstPoem >= from && cats[c].firstPoem < to, 24);
  const poemRes = scanList(titleList, cq, (i) => i >= from && i < to, LIST_LIMIT);
  return {
    poets: poetHits.map((p) => p.idx),
    cats: catRes.lines,
    poems: poemRes.lines.map(poemInfo),
    poemTotal: poemRes.total,
  };
}

// ---------------------------------------------------------------------------

const ready = init();
// Build the title/section search lists once the UI has its catalog.
ready.then(() => setTimeout(() => {
  titleList ??= buildList(titles);
  catList ??= buildList(cats.map((c) => c.title));
}, 0));

const handlers = {
  init: () => ready,
  async poem({ idx, id }) {
    await ready;
    const i = idx ?? resolveId(id);
    if (i < 0 || i >= titles.length) return null;
    const poet = poetOfPoem(i);
    const [lo, hi] = [poets[poet].firstPoem, poets[poet].firstPoem + poets[poet].poemCount];
    return {
      ...poemInfo(i),
      verses: await versesOf(i),
      prev: i > lo ? poemInfo(i - 1) : null,
      next: i + 1 < hi ? poemInfo(i + 1) : null,
    };
  },
  async catPoems({ cat }) {
    await ready;
    return ownPoems(cat);
  },
  async bios() {
    await ready;
    return utf8.decode(await fetchBin('bios.txt')).split('\n');
  },
  async resolve({ ids }) {
    await ready;
    return ids.map(resolveId);
  },
  async random({ scope }) {
    await ready;
    const [from, to] = scopeRange(scope);
    return poemInfo(from + Math.floor(Math.random() * (to - from)));
  },
  async lists({ q, scope }) {
    await ready;
    const t0 = performance.now();
    return { ...searchLists(q, scope), ms: performance.now() - t0 };
  },
  async verses({ q, scope, cursor }) {
    await ready;
    return searchVerses(q, scope, cursor);
  },
};

self.onmessage = async (e) => {
  const { id, type, payload } = e.data;
  try {
    self.postMessage({ id, result: await handlers[type](payload || {}) });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
