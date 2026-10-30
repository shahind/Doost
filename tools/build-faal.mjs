// Converts db/faal.txt (a JS array of { poem, interpretation } — Hafez ghazals with faal
// interpretations, numbered by their own order and NOT related to the Ganjoor database) into
// www/data/faal.txt: gzip, records joined by \x1e, each "line \n line … \x1f interpretation".
// Its content hash is stored in meta.json (meta.faal) so caches refresh when it changes.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'db', 'faal.txt');
const OUT = path.join(ROOT, 'www', 'data');

const raw = fs
  .readFileSync(SRC, 'utf8')
  .replace(/^﻿/, '')
  .replace(/^\s*(const|let|var)\s+\w+\s*=\s*/, '')
  .replace(/;\s*$/, '');
const items = JSON.parse(raw);
const clean = (s) => s.replace(/[\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim();

const records = items.map((it, i) => {
  const lines = String(it.poem)
    .split(/\r?\n/)
    .map(clean)
    .filter(Boolean);
  if (!lines.length || lines.length % 2) throw new Error(`faal #${i + 1}: expected whole beyts, got ${lines.length} lines`);
  const interp = clean(String(it.interpretation));
  if (!interp) throw new Error(`faal #${i + 1}: empty interpretation`);
  return `${lines.join('\n')}\x1f${interp}`;
});

const body = Buffer.from(records.join('\x1e'), 'utf8');
const gz = zlib.gzipSync(body, { level: 9 });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'faal.txt'), gz);

const metaPath = path.join(OUT, 'meta.json');
if (!fs.existsSync(metaPath)) throw new Error('www/data/meta.json missing: run tools/build-data.mjs first');
const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
meta.faal = { count: records.length, v: crypto.createHash('sha1').update(gz).digest('hex').slice(0, 10) };
fs.writeFileSync(metaPath, JSON.stringify(meta));
console.log(`faal: ${records.length} ghazals, ${(body.length / 1024).toFixed(0)} KB -> ${(gz.length / 1024).toFixed(0)} KB gzip`);
