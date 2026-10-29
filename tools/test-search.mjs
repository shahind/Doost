// Smoke test: runs the real data worker in Node against www/data.
//   node tools/test-search.mjs [query ...]
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

globalThis.fetch = async (url) => new Response(fs.readFileSync(fileURLToPath(String(url).split('?')[0])));
const replies = new Map();
let seq = 0;
globalThis.self = globalThis;
globalThis.postMessage = (msg) => replies.get(msg.id)?.(msg);
await import('../www/js/worker.js');
const call = (type, payload) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    replies.set(id, (m) => (m.error ? reject(new Error(m.error)) : resolve(m.result)));
    self.onmessage({ data: { id, type, payload } });
  });

const t0 = performance.now();
const info = await call('init');
console.log(`loaded ${info.poets.length} poets, ${info.cats.length} sections, ${info.poems} poems in ${Math.round(performance.now() - t0)} ms`);
const poetIdx = (name) => info.poets.find((p) => p.name === name).idx;

const queries = process.argv.slice(2);
if (queries.length) {
  for (const q of queries) {
    const l = await call('lists', { q });
    const v = await call('verses', { q });
    console.log(`\n«${q}»  titles ${l.poemTotal} (${l.ms.toFixed(1)} ms) · verses: ${v.hits.length} hits from ${v.candidates} candidate poems (${v.ms?.toFixed(1)} ms, scanned ${v.scanned})`);
    for (const h of v.hits.slice(0, 6)) console.log('  ', info.poets[h.poetIdx].name, '·', h.title, '·', h.lines.join(' / '));
  }
  process.exit(0);
}

let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
};

// Follow pages like the UI does.
async function verseHits(q, scope, pages = 6) {
  const hits = [];
  let cursor = 0;
  let r;
  for (let i = 0; i < pages && cursor !== -1; i++) {
    r = await call('verses', { q, scope, cursor });
    hits.push(...r.hits);
    cursor = r.cursor;
  }
  return { ...r, hits };
}
const v = await verseHits('کوزه ها');
check('verse search finds Khayyam «کوزه‌ها»', v.hits.some((h) => info.poets[h.poetIdx].name === 'خیام'));
check('results come famous poets first (Hafez/Khayyam…)', v.hits[0] && v.hits[0].poetIdx <= 3);
const hafez = await call('verses', { q: 'الا یا ایها الساقی', scope: { poet: poetIdx('حافظ') } });
check('Hafez opening ghazal found within Hafez', hafez.hits.some((h) => h.title === 'غزل شمارهٔ ۱'));
const yk = await verseHits('يك'); // Arabic ye/kaf
check('Arabic letters normalized', yk.hits.length > 0);
const l = await call('lists', { q: 'غزل' });
check('title search finds ghazals', l.poemTotal > 100);
const p = await call('poem', { idx: v.hits[0].idx });
check('poem decodes with verses', p && p.verses.length > 1 && p.next);
const hz = await verseHits('عقل اگر داند که دل', { poet: poetIdx('حافظ') });
check('a common last word («دل») still finds Hafez ghazal 10', hz.hits.some((h) => h.title === 'غزل شمارهٔ ۱۰'));
const dl = await call('verses', { q: 'دل' });
check('a very common word alone («دل») returns results', dl.hits.length > 10);
const r = await call('resolve', { ids: [1119] });
check('Ganjoor poem id resolves', r[0] >= 0);

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
