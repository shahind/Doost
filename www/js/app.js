import * as store from './store.js';
import { copyText, shareText, isNative, isElectron, plugin } from './platform.js';
import { normalizeCompact, findMatches } from './normalize.js';

// ------------------------------------------------------------------ worker RPC

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let rpcSeq = 0;
const pending = new Map();
worker.onmessage = (e) => {
  const { id, result, error } = e.data;
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  error ? p.reject(new Error(error)) : p.resolve(result);
};
const call = (type, payload) =>
  new Promise((resolve, reject) => {
    const id = ++rpcSeq;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, payload });
  });

// ------------------------------------------------------------------ helpers

const $ = (sel, root = document) => root.querySelector(sel);
const fa = (n) => Number(n).toLocaleString('fa-IR');
const icon = (name) => `<svg><use href="#i-${name}"/></svg>`;
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ESC[c]);
const el = {
  view: $('#view'),
  title: $('#title'),
  actions: $('#actions'),
  back: $('#btn-back'),
  brand: $('#brand'),
  sheet: $('#sheet'),
  backdrop: $('#sheet-backdrop'),
  toast: $('#toast'),
};
const mobile = () => matchMedia('(max-width: 899px)').matches;

let toastTimer;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 1800);
}

// Wrap normalization-aware matches of `cq` in <mark>.
function highlight(text, cq) {
  const ms = cq ? findMatches(text, cq) : [];
  if (!ms.length) return esc(text);
  let out = '';
  let last = 0;
  for (const [s, e] of ms) {
    out += esc(text.slice(last, s)) + '<mark>' + esc(text.slice(s, e)) + '</mark>';
    last = e;
  }
  return out + esc(text.slice(last));
}

// ------------------------------------------------------------------ catalog (from the worker)

let poets = [];
let cats = [];
let info = null;
const poetById = new Map();
const catById = new Map();
const poetByName = new Map();

// Category chain from the poet's root down to `catIdx`.
function catPath(catIdx) {
  const path = [];
  for (let c = catIdx; c >= 0; c = cats[c].parentIdx) path.unshift(cats[c]);
  return path;
}
function crumbs(catIdx, { includeLast = true } = {}) {
  const path = catPath(catIdx);
  const poet = poets[path[0].poetIdx];
  const parts = [`<a href="#/">خانه</a>`, `<a href="#/poet/${poet.id}">${esc(poet.name)}</a>`];
  const inner = path.slice(1, includeLast ? undefined : -1);
  for (const c of inner) parts.push(`<a href="#/cat/${c.id}">${esc(c.title)}</a>`);
  return `<nav class="crumbs">${parts.join(icon('next'))}</nav>`;
}
// Poet cards cycle through 7 tints of the Doost palette (see .t0–.t6 in app.css).
const poetTint = (p) => `t${p.id % 7}`;

// ------------------------------------------------------------------ theme & settings

function effectiveTheme() {
  const t = store.theme();
  if (t !== 'auto') return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function applySettings() {
  const t = store.theme();
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  document.documentElement.style.setProperty('--poem-scale', store.setting('font'));
  const dark = effectiveTheme() === 'dark';
  $('meta[name="theme-color"]').setAttribute('content', dark ? '#16282a' : '#35646a');
  if (isNative) {
    const sb = plugin('StatusBar');
    sb?.setStyle({ style: 'DARK' }).catch(() => {}); // light icons on the teal bar
    sb?.setBackgroundColor({ color: dark ? '#16282a' : '#35646a' }).catch(() => {});
  }
  refit();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySettings);

// ------------------------------------------------------------------ navigation

const scrolls = new Map();
const stack = []; // visited hashes, to tell "back" from "forward"
let routeKey = '';
let cleanup = null;

function setHeader({ title = '', actions = '', back = true }) {
  el.title.innerHTML = title ? `<span>${esc(title)}</span>` : '';
  el.brand.hidden = !!title;
  el.actions.innerHTML = actions;
  el.back.hidden = !back;
  requestAnimationFrame(fitTitle);
}

// A title wider than the bar slides to its end and back instead of being cut with «…».
function fitTitle() {
  const span = el.title.firstElementChild;
  el.title.classList.remove('marquee');
  if (!span) return;
  const over = span.offsetWidth - el.title.clientWidth;
  if (over <= 2) return;
  span.style.setProperty('--shift', `${over}px`);
  span.style.animationDuration = `${Math.max(7, 4 + over / 22)}s`;
  el.title.classList.add('marquee');
}
window.addEventListener('resize', () => requestAnimationFrame(fitTitle));
document.fonts?.ready.then(fitTitle);
$('#nav-settings').addEventListener('click', () => openSettings());

function parentOf(route) {
  const [path] = route.slice(1).split('?');
  const [kind, id] = path.split('/').filter(Boolean);
  if (kind === 'poem' && currentPoem) return `#/cat/${cats[currentPoem.catIdx].id}`;
  if (kind === 'cat' && catById.has(+id)) {
    const c = catById.get(+id);
    return c.parentIdx >= 0 && cats[c.parentIdx].parentIdx >= 0 ? `#/cat/${cats[c.parentIdx].id}` : `#/poet/${poets[c.poetIdx].id}`;
  }
  if (kind === 'favs' && id) return '#/favs';
  return '#/';
}

function goBack() {
  if (!el.sheet.hidden) return closeSheet();
  if (stack.length > 1) history.back();
  else location.replace(parentOf(location.hash || '#/'));
}
el.back.addEventListener('click', goBack);

function route() {
  const hash = location.hash || '#/';
  if (stack.length > 1 && stack[stack.length - 2] === hash) stack.pop();
  else if (stack[stack.length - 1] !== hash) stack.push(hash);
  scrolls.set(routeKey, el.view.scrollTop);
  cleanup?.();
  cleanup = null;
  closeSheet();
  closeMenu();
  el.actions.onclick = null;
  document.body.classList.remove('on-poem');
  const [path, qs] = hash.slice(1).split('?');
  const params = new URLSearchParams(qs || '');
  const [kind, id] = path.split('/').filter(Boolean);
  routeKey = kind === 'search' ? 'search' : hash;
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const nav = a.dataset.nav;
    a.classList.toggle('active', nav === (kind || 'home') || (nav === 'home' && ['poet', 'cat', 'poem'].includes(kind)));
  });
  let done;
  if (kind === 'poet') done = showPoet(+id);
  else if (kind === 'cat') done = showCat(+id);
  else if (kind === 'poem') done = showPoem(+id, params);
  else if (kind === 'search') done = showSearch(params);
  else if (kind === 'favs') done = showFavs(id ? +id : null);
  else if (kind === 'faal') done = id ? showFaalResult(+id) : showFaal();
  else done = showHome();
  Promise.resolve(done).then(() => {
    el.view.scrollTop = scrolls.get(routeKey) || 0;
  });
}
window.addEventListener('hashchange', route);

// ------------------------------------------------------------------ home

function showHome() {
  setHeader({ back: false });
  const sel = poets.filter((p) => store.isSelected(p.name));
  const sorted = [...poets].sort((a, b) => a.name.localeCompare(b.name, 'fa'));
  const groups = new Map();
  for (const p of sorted) {
    const l = normalizeCompact(p.name[0]).toUpperCase() || p.name[0];
    if (!groups.has(l)) groups.set(l, []);
    groups.get(l).push(p);
  }
  const card = (p) => `
    <div class="poet ${poetTint(p)}" data-href="#/poet/${p.id}" role="link" tabindex="0">
      <span class="pn">${esc(p.name)}<span class="pc">${fa(p.poemCount)} شعر</span></span>
      <button class="star ${store.isSelected(p.name) ? 'on' : ''}" data-star="${esc(p.name)}" aria-label="منتخب">${icon('star')}</button>
    </div>`;
  const last = store.lastRead();
  el.view.innerHTML = `
    <div class="page home-page">
      <a class="hero-search" href="#/search">${icon('search')}<span>جستجو در شاعران، عنوان‌ها و ابیات…</span></a>
      ${offlineCard('home')}
      ${
        last
          ? `<a class="continue" href="#/poem/${last.id}?resume=1">${icon('book')}<span class="grow"><small>ادامهٔ خواندن · ${esc(last.poet)}</small><b>${esc(last.title)}</b></span>${icon('next')}</a>`
          : ''
      }
      <a class="faal-card" href="#/faal"><span class="faal-card-mark">${SHAMSEH}</span>
        <span class="grow"><b>فال حافظ</b><small>نیت کنید و دیوان حافظ را بگشایید</small></span>${icon('next')}</a>
      ${
        sel.length
          ? `<div class="section-title">${icon('star')} شاعران منتخب</div><div class="poets">${sel.map(card).join('')}</div>`
          : ''
      }
      <div class="section-title">${icon('feather')} همه شاعران <span class="count">${fa(poets.length)} شاعر · ${fa(info.poems)} شعر</span></div>
      <div class="letters">${[...groups.keys()].map((l) => `<a href="#" data-letter="${esc(l)}">${esc(l)}</a>`).join('')}</div>
      ${[...groups]
        .map(([l, ps]) => `<div class="letter-head" id="L-${esc(l)}">${esc(l)}</div><div class="poets">${ps.map(card).join('')}</div>`)
        .join('')}
    </div>
    <button class="fab" id="fab" aria-label="شعر تصادفی" title="شعر تصادفی">${icon('shuffle')}</button>`;
  el.view.onclick = (e) => {
    const star = e.target.closest('[data-star]');
    if (star) {
      e.stopPropagation();
      const on = store.toggleSelected(star.dataset.star);
      toast(on ? 'به شاعران منتخب افزوده شد' : 'از شاعران منتخب برداشته شد');
      const top = el.view.scrollTop;
      showHome();
      el.view.scrollTop = top;
      return;
    }
    const letter = e.target.closest('[data-letter]');
    if (letter) {
      e.preventDefault();
      const head = document.getElementById('L-' + letter.dataset.letter);
      if (head) el.view.scrollTo({ top: el.view.scrollTop + head.getBoundingClientRect().top - el.view.getBoundingClientRect().top - 8, behavior: 'smooth' });
      return;
    }
    if (e.target.closest('#fab')) return randomPoem();
    const href = e.target.closest('[data-href]')?.dataset.href;
    if (href) location.hash = href;
  };
  el.view.onkeydown = (e) => {
    const href = e.key === 'Enter' && e.target.closest('[data-href]')?.dataset.href;
    if (href) location.hash = href;
  };
}

async function randomPoem(scope) {
  const p = await call('random', { scope });
  location.hash = `#/poem/${p.id}`;
}

// ------------------------------------------------------------------ poet & category

let bios = null;

function catRows(childIdxs) {
  return childIdxs
    .map((ci) => {
      const c = cats[ci];
      return `<a class="row" href="#/cat/${c.id}"><span class="ico">${icon(c.children.length ? 'folder' : 'book')}</span>
        <span class="grow"><div class="name">${esc(c.title)}</div><div class="sub">${fa(c.poemCount)} شعر</div></span>${icon('next').replace('<svg', '<svg class="chev"')}</a>`;
    })
    .join('');
}

const PAGE = 200;
function poemRows(list, from = 0) {
  return list
    .slice(from, from + PAGE)
    .map((p) => `<a class="row" href="#/poem/${p.id}"><span class="grow"><div class="name">${esc(p.title)}</div></span>${icon('next').replace('<svg', '<svg class="chev"')}</a>`)
    .join('');
}

function mountPoemList(list) {
  const box = $('#poem-list');
  if (!box) return;
  let shown = Math.min(PAGE, list.length);
  const more = () => {
    $('#more-poems')?.remove();
    box.insertAdjacentHTML('beforeend', poemRows(list, shown));
    shown = Math.min(list.length, shown + PAGE);
    if (shown < list.length) addMore();
  };
  const addMore = () => {
    box.insertAdjacentHTML('beforeend', `<button class="more-btn" id="more-poems">نمایش بیشتر (${fa(list.length - shown)})</button>`);
    const b = $('#more-poems');
    b.onclick = more;
    const io = new IntersectionObserver((en) => en[0].isIntersecting && (io.disconnect(), more()), { root: el.view, rootMargin: '600px' });
    io.observe(b);
  };
  if (shown < list.length) addMore();
}

async function showPoet(id) {
  const poet = poetById.get(id);
  if (!poet) return showHome();
  const root = cats[poet.rootCat];
  setHeader({
    title: poet.name,
    actions: `<a class="icon-btn narrow-only" href="#/search?poet=${poet.id}" title="جستجو در آثار" aria-label="جستجو در آثار">${icon('search')}</a>
              <button class="icon-btn narrow-only" id="act-random" title="شعر تصادفی" aria-label="شعر تصادفی">${icon('shuffle')}</button>`,
  });
  const own = await call('catPoems', { cat: root.idx });
  el.view.innerHTML = `
    <div class="page">
      <nav class="crumbs"><a href="#/">خانه</a></nav>
      <section class="poet-hero">
        <h2>${esc(poet.name)}</h2>
        <div class="stat">${fa(poet.poemCount)} شعر${root.children.length ? ` در ${fa(root.children.length)} بخش` : ''}</div>
        <div class="bio" id="bio"></div>
        <div class="hero-actions">
          <a class="chip-btn primary" href="#/search?poet=${poet.id}">${icon('search')} جستجو در آثار</a>
          <button class="chip-btn" data-random>${icon('shuffle')} شعر تصادفی</button>
          <button class="chip-btn ${store.isSelected(poet.name) ? 'on' : ''}" data-star>${icon('star')} منتخب</button>
          ${poet.id === 2 ? `<a class="chip-btn faal-chip" href="#/faal">${icon('book')} فال حافظ</a>` : ''}
        </div>
      </section>
      ${root.children.length ? `<div class="section-title">${icon('folder')} بخش‌ها</div><div class="card">${catRows(root.children)}</div>` : ''}
      ${own.length ? `<div class="section-title">${icon('book')} اشعار <span class="count">${fa(own.length)}</span></div><div class="card" id="poem-list">${poemRows(own)}</div>` : ''}
    </div>`;
  mountPoemList(own);
  const random = () => randomPoem({ poet: poet.idx });
  $('#act-random').onclick = random;
  el.view.onclick = (e) => {
    if (e.target.closest('[data-random]')) random();
    const star = e.target.closest('[data-star]');
    if (star) star.classList.toggle('on', store.toggleSelected(poet.name));
    const bio = e.target.closest('#bio');
    if (bio) bio.classList.toggle('open');
  };
  bios ??= await call('bios').catch(() => null); // offline and not cached yet: no bio
  if (!bios) return $('#bio')?.remove();
  const b = $('#bio');
  if (b) b.textContent = bios[poet.idx] || '';
  if (b && !bios[poet.idx]) b.remove();
}

async function showCat(id) {
  const c = catById.get(id);
  if (!c) return showHome();
  if (c.parentIdx < 0) return showPoet(poets[c.poetIdx].id);
  setHeader({
    title: c.title,
    actions: `<a class="icon-btn narrow-only" href="#/search?cat=${c.id}" title="جستجو در این بخش" aria-label="جستجو در این بخش">${icon('search')}</a>
              <button class="icon-btn narrow-only" data-random title="شعر تصادفی" aria-label="شعر تصادفی">${icon('shuffle')}</button>`,
  });
  const own = await call('catPoems', { cat: c.idx });
  el.view.innerHTML = `
    <div class="page">
      ${crumbs(c.idx, { includeLast: false })}
      <header class="poem-head">
        <h2>${esc(c.title)}</h2>
        <div class="by">${esc(poets[c.poetIdx].name)} · ${fa(c.poemCount)} شعر${c.children.length ? ` در ${fa(c.children.length)} بخش` : ''}</div>
        <div class="poem-actions wide-only">
          <a class="chip-btn" href="#/search?cat=${c.id}">${icon('search')} جستجو در این بخش</a>
          <button class="chip-btn" data-random>${icon('shuffle')} شعر تصادفی از این بخش</button>
        </div>
      </header>
      ${c.children.length ? `<div class="section-title">${icon('folder')} بخش‌ها</div><div class="card">${catRows(c.children)}</div>` : ''}
      ${own.length ? `<div class="section-title">${icon('book')} اشعار <span class="count">${fa(own.length)}</span></div><div class="card" id="poem-list">${poemRows(own)}</div>` : ''}
      ${!own.length && !c.children.length ? `<div class="empty">محتوایی در این بخش یافت نشد.</div>` : ''}
    </div>`;
  mountPoemList(own);
  const random = (e) => e.target.closest('[data-random]') && randomPoem({ cat: c.idx });
  el.view.onclick = random;
  el.actions.onclick = random;
}

// ------------------------------------------------------------------ poem

let currentPoem = null;

function verseBlocks(verses, cq) {
  let html = '';
  const line = (t) => `<p>${highlight(t, cq)}</p>`;
  for (let k = 0; k < verses.length; ) {
    const [pos, text] = verses[k];
    if (pos === 0 && verses[k + 1]?.[0] === 1) {
      html += `<div class="b beyt" data-v="${k}" data-n="2"><p class="m1">${highlight(text, cq)}</p><p class="m2">${highlight(verses[k + 1][1], cq)}</p></div>`;
      k += 2;
      continue;
    }
    const cls = pos === 5 || pos === -1 ? 'prose' : pos === 2 || pos === 3 ? 'c2' : pos === 4 ? 'single' : 'center';
    html += `<div class="b ${cls}" data-v="${k}" data-n="1">${line(text)}</div>`;
    k++;
  }
  return html;
}

// Keep each beyt on one line: measure every half-line and shrink the beyt just enough
// (both half-lines together, so they stay the same size). Only extreme lines wrap.
const MIN_FIT = 0.72;
function fitVerses(root) {
  if (!root?.isConnected) return;
  const blocks = [...root.querySelectorAll('.beyt, .center, .c2, .single')];
  for (const b of blocks) {
    b.style.fontSize = '';
    b.classList.remove('wrap');
  }
  const ratios = blocks.map((b) => {
    let r = 1;
    for (const p of b.children) if (p.tagName === 'P' && p.scrollWidth > p.clientWidth) r = Math.min(r, p.clientWidth / p.scrollWidth);
    return r;
  });
  blocks.forEach((b, i) => {
    const r = ratios[i] * 0.98;
    if (ratios[i] >= 1) return;
    if (r >= MIN_FIT) b.style.fontSize = r.toFixed(3) + 'em';
    else {
      b.style.fontSize = MIN_FIT + 'em';
      b.classList.add('wrap');
    }
  });
}
let fitTimer;
const refit = () => {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(() => fitVerses($('#verses')), 80);
};
window.addEventListener('resize', refit);
document.fonts?.ready.then(refit);

// ------------------------------------------------------------------ dictionary look-up (Yaad)

// Letters, digits, diacritics and ZWNJ make up a word (so «کوزه‌ها» stays one word).
const WORD_CHAR = /[\p{L}\p{M}\p{N}‌]/u;

// The word under a screen point inside `root`, or ''.
function wordAt(x, y, root) {
  let node;
  let offset;
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    node = pos?.offsetNode;
    offset = pos?.offset;
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    node = r?.startContainer;
    offset = r?.startOffset;
  }
  if (!node || node.nodeType !== 3 || !root.contains(node)) return '';
  const t = node.nodeValue;
  let s = offset;
  let e = offset;
  while (s > 0 && WORD_CHAR.test(t[s - 1])) s--;
  while (e < t.length && WORD_CHAR.test(t[e])) e++;
  return t.slice(s, e).replace(/^‌+|‌+$/g, '');
}

async function lookupWord(word) {
  word = (word || '').replace(/[^\p{L}\p{M}\p{N}‌ ]+/gu, ' ').trim();
  if (!word) return;
  const { lookupInYaad } = await import('./platform.js');
  toast(`«${word}» در «یاد» باز می‌شود…`);
  lookupInYaad(word);
}

// Selecting a word (double-click, or long-press on touch screens) offers a dictionary look-up.
// The chip sits below the selection so it doesn't cover the system's own selection menu.
let selChip = null;
let selTimer;
function hideSelChip() {
  selChip?.remove();
  selChip = null;
}
document.addEventListener('selectionchange', () => {
  clearTimeout(selTimer);
  selTimer = setTimeout(() => {
    const sel = getSelection();
    const text = String(sel).trim();
    const inPoem = sel.rangeCount && sel.anchorNode && sel.anchorNode.parentElement?.closest('.verses');
    if (!text || !inPoem || text.length > 40 || text.split(/\s+/).length > 3) return hideSelChip();
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) return hideSelChip();
    hideSelChip();
    selChip = document.createElement('button');
    selChip.className = 'sel-chip';
    selChip.innerHTML = `${icon('book')} جستجوی «${esc(text)}» در لغت‌نامه`;
    document.body.append(selChip);
    const w = selChip.offsetWidth;
    selChip.style.left = `${Math.min(innerWidth - w - 8, Math.max(8, rect.left + rect.width / 2 - w / 2))}px`;
    selChip.style.top = `${Math.min(innerHeight - 60, rect.bottom + 12)}px`;
    // pointerdown (not click) so the selection is still there when we read it.
    selChip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      hideSelChip();
      lookupWord(text);
    });
  }, 250);
});
el.view.addEventListener('scroll', hideSelChip, { passive: true });

// Small dropdown menu anchored to a button.
let menuEl = null;
function closeMenu() {
  menuEl?.remove();
  menuEl = null;
}
function openMenu(anchor, items) {
  if (menuEl) return closeMenu();
  menuEl = document.createElement('div');
  menuEl.className = 'menu';
  menuEl.innerHTML = items.map(([label], i) => `<button data-i="${i}">${label}</button>`).join('');
  document.body.append(menuEl);
  const r = anchor.getBoundingClientRect();
  menuEl.style.top = `${r.bottom + 6}px`;
  menuEl.style.left = `${Math.max(8, r.left)}px`;
  menuEl.onclick = (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    const fn = items[+b.dataset.i][1];
    closeMenu();
    fn();
  };
  setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 0);
}

// Share sheet: text preview, copy, system share, and share as picture.
function openShareSheet(spec) {
  const note = spec.note ? `\n\nتعبیر: ${spec.note}` : '';
  const text = `${spec.verses.map((v) => v[1]).join('\n')}${note}\n\n${spec.poet}، ${spec.beyt ? '' : spec.section + '، '}${spec.title}\nارسال شده از دوست`;
  openSheet(
    `<h3>${spec.beyt ? 'اشتراک‌گذاری بیت' : 'اشتراک‌گذاری شعر'}</h3>
     <div class="share-preview">${esc(text)}</div>
     <div class="share-actions">
       <button class="share-act" data-s="copy">${icon('copy')}<span>رونوشت متن</span></button>
       <button class="share-act" data-s="text">${icon('share')}<span>اشتراک متن</span></button>
       <button class="share-act" data-s="image">${icon('image')}<span>اشتراک تصویر</span></button>
     </div>
     <div class="sheet-row"><button class="btn ghost" data-close>بستن</button></div>`,
    (s) => {
      s.onclick = async (e) => {
        if (e.target.closest('[data-close]')) return closeSheet();
        const act = e.target.closest('[data-s]');
        if (!act) return;
        if (act.dataset.s === 'copy') {
          await copyText(text);
          toast('متن رونوشت شد');
          closeSheet();
        } else if (act.dataset.s === 'text') {
          const r = await shareText(spec.title, text);
          if (r === 'copied') toast('متن رونوشت شد');
          if (r !== 'cancelled') closeSheet();
        } else if (act.dataset.s === 'image') {
          act.disabled = true;
          act.querySelector('span').textContent = 'در حال ساختن تصویر…';
          try {
            const { renderPoemImage, shareImage } = await import('./share.js');
            const blob = await renderPoemImage(spec);
            const r = await shareImage(blob, `doost-${Date.now()}.png`, spec.title);
            if (r === 'saved') toast('تصویر ذخیره شد');
            if (r !== 'cancelled') closeSheet();
          } catch (err) {
            toast('ساختن تصویر ممکن نشد');
          } finally {
            act.disabled = false;
            const label = act.querySelector('span');
            if (label) label.textContent = 'اشتراک تصویر';
          }
        }
      };
    },
  );
}

function poemContext(p) {
  const path = catPath(p.catIdx);
  const poet = poets[path[0].poetIdx];
  return {
    poet,
    path,
    fav: {
      id: p.id,
      title: p.title,
      cat_id: cats[p.catIdx].id,
      poet_id: poet.id,
      poet_name: poet.name,
      book_name: path[1]?.title || '',
      section_name: path[2]?.title || '',
    },
  };
}

function poemText(p, verses) {
  const { poet } = poemContext(p);
  return `${verses.map((v) => v[1]).join('\n')}\n\n${poet.name}، ${cats[p.catIdx].title}، ${p.title}\nارسال شده از دوست`;
}

async function showPoem(id, params) {
  let p;
  try {
    p = await call('poem', { id });
  } catch (err) {
    // Its text block isn't cached and the network is unavailable.
    setHeader({ title: 'شعر' });
    el.view.innerHTML = `<div class="page">${offlineMessage('این شعر')}</div>`;
    return;
  }
  if (!p) {
    el.view.innerHTML = `<div class="page"><div class="empty">این شعر یافت نشد.</div></div>`;
    return;
  }
  const dir = currentPoem && p.prev?.id === currentPoem.id ? 'next' : currentPoem && p.next?.id === currentPoem.id ? 'prev' : '';
  currentPoem = p;
  const { poet, fav } = poemContext(p);
  const q = params.get('q') || '';
  const cq = normalizeCompact(q);
  const isFav = store.isFav(p.id);
  // Phones: favorite / share / ⋮ menu in the top bar. Wide screens: buttons under the title.
  setHeader({
    title: p.title,
    actions: `<button class="icon-btn narrow-only ${isFav ? 'on' : ''}" data-act="fav" id="act-fav" aria-label="نشان" title="نشان">${icon('heart')}</button>
              <button class="icon-btn narrow-only" data-act="share" aria-label="اشتراک‌گذاری" title="اشتراک‌گذاری">${icon('share')}</button>
              <button class="icon-btn narrow-only" data-act="menu" aria-label="بیشتر" title="بیشتر">${icon('more')}</button>`,
  });
  document.body.classList.add('on-poem');
  el.view.innerHTML = `
    <div class="page poem ${dir ? 'slide-' + dir : ''}">
      ${crumbs(p.catIdx)}
      <header class="poem-head">
        <h2>${esc(p.title)}</h2>
        <div class="by">${esc(poet.name)}</div>
        <div class="poem-actions wide-only">
          <button class="chip-btn ${isFav ? 'on' : ''}" data-act="fav">${icon('heart')} <span>${isFav ? 'نشان‌شده' : 'نشان'}</span></button>
          <button class="chip-btn" data-act="share">${icon('share')} اشتراک</button>
          <button class="chip-btn" data-act="copy">${icon('copy')} رونوشت</button>
          <a class="chip-btn" href="#/search?cat=${cats[p.catIdx].id}">${icon('search')} جستجو در این بخش</a>
        </div>
      </header>
      <article class="verses" id="verses">${verseBlocks(p.verses, cq)}</article>
      <nav class="poem-nav">
        ${p.prev ? `<a href="#/poem/${p.prev.id}">${icon('back')}<span><small>شعر پیشین</small>${esc(p.prev.title)}</span></a>` : '<span></span>'}
        ${p.next ? `<a class="next" href="#/poem/${p.next.id}"><span><small>شعر پسین</small>${esc(p.next.title)}</span>${icon('next')}</a>` : '<span></span>'}
      </nav>
    </div>`;

  const toggleFav = () => {
    const on = store.toggleFav(fav);
    document.querySelectorAll('[data-act="fav"]').forEach((b) => b.classList.toggle('on', on));
    const label = el.view.querySelector('[data-act="fav"] span');
    if (label) label.textContent = on ? 'نشان‌شده' : 'نشان';
    toast(on ? 'به نشان‌ها افزوده شد' : 'از نشان‌ها برداشته شد');
  };
  const sharePoem = () => openShareSheet({ title: p.title, poet: poet.name, section: cats[p.catIdx].title, verses: p.verses });

  const onAct = async (act, target) => {
    if (act === 'fav') return toggleFav();
    if (act === 'share') return sharePoem();
    if (act === 'copy') {
      await copyText(poemText(p, p.verses));
      return toast('متن شعر رونوشت شد');
    }
    if (act === 'font') return openSettings();
    if (act === 'menu')
      return openMenu(target, [
        [icon('search') + ' جستجو در این بخش', () => (location.hash = `#/search?cat=${cats[p.catIdx].id}`)],
        [icon('feather') + ' صفحهٔ ' + esc(poet.name), () => (location.hash = `#/poet/${poet.id}`)],
        [icon('settings') + ' تنظیمات', openSettings],
      ]);
  };
  el.actions.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (b) onAct(b.dataset.act, b);
  };

  const versesEl = $('#verses');
  el.view.onclick = async (e) => {
    const actBtn = e.target.closest('[data-act]');
    if (actBtn) return onAct(actBtn.dataset.act, actBtn);
    const tool = e.target.closest('[data-vt]');
    if (tool) {
      const b = tool.closest('.b');
      const k = +b.dataset.v;
      const verses = p.verses.slice(k, k + +b.dataset.n);
      const text = `${verses.map((v) => v[1]).join('\n')}\n\n${poet.name}، ${p.title}\nارسال شده از دوست`;
      if (tool.dataset.vt === 'dict') lookupWord(tool.dataset.word);
      else if (tool.dataset.vt === 'copy') {
        await copyText(text);
        toast('بیت رونوشت شد');
      } else openShareSheet({ title: p.title, poet: poet.name, section: cats[p.catIdx].title, verses, beyt: true });
      clearVerseTools();
      return;
    }
    // Tap a verse (without selecting text) to get copy/share for that beyt, and a dictionary
    // look-up for the tapped word.
    const b = e.target.closest('.b');
    if (b && !String(getSelection()).trim()) {
      const was = b.classList.contains('sel');
      clearVerseTools();
      if (!was) {
        const word = wordAt(e.clientX, e.clientY, b);
        b.classList.add('sel');
        b.insertAdjacentHTML(
          'afterbegin',
          `<div class="verse-tools">
            ${word ? `<button data-vt="dict" data-word="${esc(word)}">${icon('book')} «${esc(word)}» در لغت‌نامه</button>` : ''}
            <button data-vt="copy">${icon('copy')} رونوشت بیت</button><button data-vt="share">${icon('share')} اشتراک بیت</button></div>`,
        );
      }
    } else if (!b) clearVerseTools();
  };
  const clearVerseTools = () => {
    versesEl.querySelectorAll('.b.sel').forEach((x) => x.classList.remove('sel'));
    versesEl.querySelectorAll('.verse-tools').forEach((x) => x.remove());
  };

  // Focus: a verse from a search hit, the first highlighted word, or the saved position.
  const v = params.get('v');
  let focus = v != null ? [...versesEl.querySelectorAll('.b')].filter((b) => +b.dataset.v <= +v).pop() : null;
  focus ??= versesEl.querySelector('mark')?.closest('.b');
  const last = store.lastRead();
  fitVerses(versesEl);
  if (focus) {
    focus.classList.add('focus');
    scrolls.delete(routeKey);
    // Scroll only the view (scrollIntoView would also try to scroll the page itself).
    requestAnimationFrame(() => {
      const r = focus.getBoundingClientRect();
      const vr = el.view.getBoundingClientRect();
      el.view.scrollTop += r.top - vr.top - (vr.height - r.height) / 2;
    });
  } else if (params.get('resume') && last?.id === p.id) {
    scrolls.set(routeKey, last.scroll || 0);
  } else if (dir) scrolls.delete(routeKey);

  const entry = { id: p.id, title: p.title, poet: poet.name };
  store.addRecent(entry);
  store.setLastRead({ ...entry, scroll: last?.id === p.id ? last.scroll : 0 });
  let saveTimer;
  const onScroll = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.setLastRead({ ...entry, scroll: el.view.scrollTop }), 300);
  };
  el.view.addEventListener('scroll', onScroll, { passive: true });

  // Prev / next: arrow keys and horizontal swipes (RTL: swipe right = next).
  const go = (target) => target && (location.hash = `#/poem/${target.id}`);
  const onKey = (e) => {
    if (e.target.closest?.('input,textarea') || !el.sheet.hidden) return;
    if (e.key === 'ArrowLeft') go(p.next);
    if (e.key === 'ArrowRight') go(p.prev);
  };
  let sx = 0;
  let sy = 0;
  const onStart = (e) => {
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
  };
  const onEnd = (e) => {
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 2 && !String(getSelection()).trim()) go(dx > 0 ? p.next : p.prev);
  };
  document.addEventListener('keydown', onKey);
  el.view.addEventListener('touchstart', onStart, { passive: true });
  el.view.addEventListener('touchend', onEnd, { passive: true });
  cleanup = () => {
    el.view.removeEventListener('scroll', onScroll);
    document.removeEventListener('keydown', onKey);
    el.view.removeEventListener('touchstart', onStart);
    el.view.removeEventListener('touchend', onEnd);
    if (!location.hash.startsWith('#/poem/')) currentPoem = null;
  };
}

// ------------------------------------------------------------------ search

const search = { q: '', scope: null, seq: 0, cursor: -1, hits: 0, candidates: 0, loading: false };

function scopeFromParams(params) {
  if (params.get('cat') && catById.has(+params.get('cat'))) {
    const c = catById.get(+params.get('cat'));
    return c.parentIdx < 0 ? { poet: c.poetIdx } : { cat: c.idx };
  }
  if (params.get('poet') && poetById.has(+params.get('poet'))) return { poet: poetById.get(+params.get('poet')).idx };
  return null;
}
function scopeLabel(scope) {
  if (!scope) return 'همه شاعران';
  if (scope.poet != null) return poets[scope.poet].name;
  const path = catPath(scope.cat);
  return [poets[path[0].poetIdx].name, ...path.slice(1).map((c) => c.title)].join(' › ');
}
function scopeParams(scope) {
  if (!scope) return '';
  return scope.poet != null ? `poet=${poets[scope.poet].id}` : `cat=${cats[scope.cat].id}`;
}

function showSearch(params) {
  setHeader({ title: 'جستجو', back: stack.length > 1 });
  search.q = params.get('q') || '';
  search.scope = scopeFromParams(params);
  el.view.innerHTML = `
    <div class="page">
      <div class="search-top">
        <label class="search-field">
          ${icon('search')}
          <input id="q" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" spellcheck="false"
                 placeholder="جستجو در شاعران، عنوان‌ها و ابیات…" aria-label="جستجو" value="${esc(search.q)}" />
          <button class="icon-btn" id="q-clear" aria-label="پاک کردن" ${search.q ? '' : 'hidden'}>${icon('x')}</button>
        </label>
        <div class="scope">
          <button class="chip-btn ${search.scope ? 'active' : ''}" id="scope-btn">${icon('filter')} <span>${esc(scopeLabel(search.scope))}</span></button>
          ${search.scope ? `<button class="chip-btn" id="scope-clear">${icon('x')} همه شاعران</button>` : ''}
        </div>
        <div class="status" id="status"></div>
      </div>
      <div id="results"></div>
    </div>`;
  const input = $('#q');
  input.addEventListener('input', () => {
    $('#q-clear').hidden = !input.value;
    runSearch(input.value);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      store.addSearch(input.value);
      input.blur();
    }
  });
  $('#q-clear').onclick = () => {
    input.value = '';
    $('#q-clear').hidden = true;
    runSearch('');
    input.focus();
  };
  $('#scope-btn').onclick = () => openScopeSheet();
  $('#scope-clear')?.addEventListener('click', () => setScope(null));
  el.view.onclick = (e) => {
    const s = e.target.closest('[data-q]');
    if (s) {
      input.value = s.dataset.q;
      $('#q-clear').hidden = false;
      runSearch(s.dataset.q);
    }
    if (e.target.closest('#clear-searches')) {
      store.clearSearches();
      runSearch('');
    }
    const ex = e.target.closest('[data-expand]');
    if (ex) {
      ex.previousElementSibling.classList.remove('short');
      ex.remove();
    }
    if (e.target.closest('.hit, .row')) store.addSearch(search.q);
  };
  runSearch(search.q, true);
  if (!search.q || !mobile()) setTimeout(() => input.focus(), 50);
}

function setScope(scope) {
  search.scope = scope;
  const qs = [search.q && `q=${encodeURIComponent(search.q)}`, scopeParams(scope)].filter(Boolean).join('&');
  location.replace(`#/search${qs ? '?' + qs : ''}`);
}

let verseTimer;
// Long title/section lists start collapsed so verse results stay in view.
const SHORT = 5;
const collapse = (n) => (n > SHORT ? `<button class="more-btn" data-expand>نمایش همه (${fa(n)})</button>` : '');
const shortCls = (n) => (n > SHORT ? ' short' : '');
async function runSearch(q, initial = false) {
  const seq = ++search.seq;
  search.q = q;
  clearTimeout(verseTimer);
  if (!initial) {
    const qs = [q && `q=${encodeURIComponent(q)}`, scopeParams(search.scope)].filter(Boolean).join('&');
    history.replaceState(null, '', `#/search${qs ? '?' + qs : ''}`);
    stack[stack.length - 1] = location.hash;
  }
  const results = $('#results');
  const status = $('#status');
  if (!normalizeCompact(q)) {
    const recent = store.searches();
    status.textContent = '';
    results.innerHTML = recent.length
      ? `<div class="section-title">${icon('clock')} جستجوهای اخیر <button class="chip-btn" id="clear-searches" style="margin-inline-start:auto">${icon('trash')} پاک کردن</button></div>
         <div class="poet-chips">${recent.map((s) => `<button class="chip-btn" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>`
      : `<div class="empty">${icon('search')}<br/>نام شاعر، عنوان شعر یا بخشی از یک بیت را بنویسید.<br/><small>نیم‌فاصله، اعراب و ی/ک عربی اهمیتی ندارند.</small></div>`;
    return;
  }
  const cq = normalizeCompact(q);
  const l = await call('lists', { q, scope: search.scope });
  if (seq !== search.seq) return;
  let html = '';
  if (l.poets.length) {
    html += `<div class="section-title">${icon('feather')} شاعران</div><div class="poet-chips">${l.poets
      .map((pi) => `<a class="chip-btn" href="#/poet/${poets[pi].id}">${highlight(poets[pi].name, cq)}</a>`)
      .join('')}</div>`;
  }
  if (l.cats.length) {
    html += `<div class="section-title">${icon('folder')} بخش‌ها <span class="count">${fa(l.cats.length)}</span></div><div class="card${shortCls(l.cats.length)}">${l.cats
      .map((ci) => {
        const c = cats[ci];
        return `<a class="row" href="#/cat/${c.id}"><span class="grow"><div class="name">${highlight(c.title, cq)}</div><div class="sub">${esc(poets[c.poetIdx].name)} · ${fa(c.poemCount)} شعر</div></span></a>`;
      })
      .join('')}</div>${collapse(l.cats.length)}`;
  }
  if (l.poems.length) {
    html += `<div class="section-title">${icon('book')} عنوان‌ها <span class="count">${fa(l.poemTotal)}</span></div><div class="card${shortCls(l.poems.length)}">${l.poems
      .map(
        (p) => `<a class="row" href="#/poem/${p.id}"><span class="grow"><div class="name">${highlight(p.title, cq)}</div>
          <div class="sub">${esc(poets[p.poetIdx].name)} · ${esc(cats[p.catIdx].title)}</div></span></a>`,
      )
      .join('')}</div>${collapse(l.poems.length)}`;
  }
  html += `<div id="verse-section"><div class="spinner"></div></div>`;
  results.innerHTML = html;
  status.textContent = '';
  // Verse search loads index shards and text blocks: wait for a pause in typing.
  verseTimer = setTimeout(() => loadVerses(seq, true), 220);
}

async function loadVerses(seq, first, cursor = first ? 0 : search.cursor) {
  if (search.loading && cursor === search.cursor && !first) return;
  search.loading = true;
  let r;
  try {
    r = await call('verses', { q: search.q, scope: search.scope, cursor });
  } catch (err) {
    // Index shards or text blocks aren't cached and the network is unavailable.
    search.loading = false;
    if (seq !== search.seq) return;
    $('#verse-more')?.remove();
    const sec = $('#verse-section');
    if (sec) sec.insertAdjacentHTML(first ? 'afterbegin' : 'beforeend', offlineMessage('جستجو در متن اشعار'));
    sec?.querySelector('.spinner')?.remove();
    return;
  }
  search.loading = false;
  if (seq !== search.seq) return;
  // A page can end on its time budget before finding anything: keep scanning.
  if (!r.hits.length && r.cursor !== -1) {
    search.candidates = r.candidates;
    $('#status').textContent = `در حال جستجو در ${fa(r.candidates)} شعر…`;
    return loadVerses(seq, first, r.cursor);
  }
  const sec = $('#verse-section');
  const cq = normalizeCompact(search.q);
  if (first) {
    search.hits = 0;
    search.candidates = r.candidates;
    if (!r.hits.length && r.cursor === -1) {
      const none = !$('#results .card, #results .poet-chips');
      sec.innerHTML = r.tooCommon
        ? `<div class="empty">این واژه بسیار رایج است؛ واژه یا عبارت دقیق‌تری بنویسید.</div>`
        : none
          ? `<div class="empty">${icon('search')}<br/>نتیجه‌ای برای «${esc(search.q)}» یافت نشد.</div>`
          : '';
      $('#status').textContent = '';
      return;
    }
    sec.innerHTML = `<div class="section-title">${icon('feather')} ابیات <span class="count" id="hit-count"></span></div><div class="card" id="hits"></div>`;
  }
  search.cursor = r.cursor;
  search.hits += r.hits.length;
  $('#hits').insertAdjacentHTML(
    'beforeend',
    r.hits
      .map(
        (h) => `<a class="hit" href="#/poem/${h.id}?q=${encodeURIComponent(search.q)}&v=${h.verse}">
          <div class="lines">${h.lines.map((t) => `<p>${highlight(t, cq)}</p>`).join('')}</div>
          <div class="meta"><b>${esc(poets[h.poetIdx].name)}</b> · ${esc(cats[h.catIdx].title)} · ${esc(h.title)}</div></a>`,
      )
      .join(''),
  );
  $('#hit-count').textContent = `${fa(search.hits)}${r.cursor !== -1 ? '+' : ''} بیت`;
  $('#status').textContent = `در ${fa(search.candidates)} شعر`;
  $('#verse-more')?.remove();
  if (r.cursor !== -1) {
    sec.insertAdjacentHTML('beforeend', `<div id="verse-more"><div class="spinner"></div></div>`);
    const io = new IntersectionObserver(
      (en) => {
        if (!en[0].isIntersecting) return;
        io.disconnect();
        loadVerses(seq, false);
      },
      { root: el.view, rootMargin: '800px' },
    );
    io.observe($('#verse-more'));
  }
}

// Scope picker: poet, then optionally a book / section inside it.
function openScopeSheet(catIdx = null) {
  if (catIdx == null) {
    openSheet(
      `<h3>جستجو در آثار…</h3>
       <input class="text-input" id="poet-filter" placeholder="نام شاعر…" autocomplete="off"/>
       <div class="pick-list" id="pick"></div>
       <div class="sheet-row"><button class="btn ghost" data-pick-all>همه شاعران</button><button class="btn ghost" data-close>بستن</button></div>`,
      (s) => {
        const draw = (f) => {
          const cf = normalizeCompact(f);
          $('#pick', s).innerHTML = poets
            .filter((p) => !cf || findMatches(p.name, cf, 1).length)
            .map((p) => `<div class="row" data-poet="${p.idx}"><span class="grow"><div class="name">${esc(p.name)}</div></span><span class="num">${fa(p.poemCount)}</span></div>`)
            .join('');
        };
        draw('');
        $('#poet-filter', s).oninput = (e) => draw(e.target.value);
        s.onclick = (e) => {
          const r = e.target.closest('[data-poet]');
          if (r) {
            const poet = poets[+r.dataset.poet];
            if (cats[poet.rootCat].children.length) openScopeSheet(poet.rootCat);
            else {
              closeSheet();
              setScope({ poet: poet.idx });
            }
          }
          if (e.target.closest('[data-pick-all]')) {
            closeSheet();
            setScope(null);
          }
          if (e.target.closest('[data-close]')) closeSheet();
        };
        if (!mobile()) setTimeout(() => $('#poet-filter', s).focus(), 50);
      },
    );
    return;
  }
  const c = cats[catIdx];
  const isRoot = c.parentIdx < 0;
  const label = isRoot ? poets[c.poetIdx].name : c.title;
  openSheet(
    `<h3>${esc(scopeLabel(isRoot ? { poet: c.poetIdx } : { cat: c.idx }))}</h3>
     <div class="pick-list">
       <div class="row" data-here><span class="grow"><div class="name">همهٔ «${esc(label)}»</div></span><span class="num">${fa(c.poemCount)}</span></div>
       ${c.children
         .map((ci) => `<div class="row" data-cat="${ci}"><span class="grow"><div class="name">${esc(cats[ci].title)}</div></span><span class="num">${fa(cats[ci].poemCount)}</span>${cats[ci].children.length ? icon('next') : ''}</div>`)
         .join('')}
     </div>
     <div class="sheet-row"><button class="btn ghost" data-up>بازگشت</button><button class="btn ghost" data-close>بستن</button></div>`,
    (s) => {
      s.onclick = (e) => {
        if (e.target.closest('[data-here]')) {
          closeSheet();
          setScope(isRoot ? { poet: c.poetIdx } : { cat: c.idx });
        }
        const r = e.target.closest('[data-cat]');
        if (r) {
          const ci = +r.dataset.cat;
          if (cats[ci].children.length) openScopeSheet(ci);
          else {
            closeSheet();
            setScope({ cat: ci });
          }
        }
        if (e.target.closest('[data-up]')) openScopeSheet(isRoot ? null : c.parentIdx);
        if (e.target.closest('[data-close]')) closeSheet();
      };
    },
  );
}

// ------------------------------------------------------------------ faal hafez
//
// A separate collection (db/faal.txt: ghazals with interpretations, own numbering), never mixed
// with the Ganjoor poems. The experience follows the tradition: make an intention, then open
// the Divan. The user holds the closed book while forming the intention; it opens on release
// of the full hold. No randomness theatrics: calm light, the book, the words of the invocation.

// A shamseh (sun medallion) from classic Persian bookbinding.
const SHAMSEH = `<svg class="shamseh" viewBox="0 0 100 100" aria-hidden="true">
  <circle cx="50" cy="50" r="46" />
  <rect x="21" y="21" width="58" height="58" rx="3" />
  <rect x="21" y="21" width="58" height="58" rx="3" transform="rotate(45 50 50)" />
  <circle cx="50" cy="50" r="19" />
  <circle cx="50" cy="50" r="10" />
  <path d="M50 4v12M50 84v12M4 50h12M84 50h12M17.5 17.5l8.5 8.5M74 74l8.5 8.5M82.5 17.5 74 26M26 74l-8.5 8.5" />
</svg>`;

const INVOCATION = [
  'ای حافظ شیرازی!',
  'تو محرم هر رازی،',
  'تو را به خدا و به شاخ نباتت قسم می‌دهم',
  'که هر چه صلاح و مصلحت می‌بینی',
  'برایم آشکار و آرزوی مرا برآورده سازی.',
];

function showFaal() {
  setHeader({ title: 'فال حافظ' });
  el.view.onclick = null;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.view.innerHTML = `
    <div class="page faal">
      <nav class="crumbs"><a href="#/">خانه</a>${icon('next')}<a href="#/poet/2">حافظ</a></nav>
      <section class="faal-ritual">
        <h2 class="faal-step">نیت کنید</h2>
        <div class="faal-invocation">${INVOCATION.map((l, i) => `<span style="animation-delay:${0.25 + i * 0.45}s">${l}</span>`).join('')}</div>
        <div class="divan-stage" id="stage">
          <div class="divan-light"></div>
          <button class="divan" id="divan" aria-label="دیوان حافظ — برای گشودن، نگه دارید" aria-describedby="faal-hint">
            <span class="divan-block"><span class="divan-lines"></span></span>
            <span class="leaf"></span><span class="leaf"></span><span class="leaf"></span>
            <span class="divan-cover">
              <span class="cover-front"><span class="divan-frame">${SHAMSEH}<span class="divan-title">دیوان حافظ</span></span></span>
              <span class="cover-back"></span>
            </span>
          </button>
        </div>
        <div class="faal-meter"><span></span></div>
        <p class="faal-hint" id="faal-hint">در دل نیت کنید، سپس انگشت خود را روی کتاب نگه دارید.</p>
      </section>
    </div>`;

  const stage = $('#stage');
  const ritual = stage.closest('.faal-ritual');
  const book = $('#divan');
  const hint = $('#faal-hint');
  call('faal', { n: 1 }).catch(() => {}); // warm the data while the user reads
  const HOLD = reduce ? 900 : 2600;
  const HINTS = [
    [0, 'در دل نیت کنید…'],
    [0.4, 'نیت خود را در دل نگه دارید…'],
    [0.8, 'دیوان گشوده می‌شود…'],
  ];
  let p = 0;
  let holding = false;
  let done = false;
  let last = 0;
  let timer = 0;

  // A plain 60 fps timer (not requestAnimationFrame, which some WebViews throttle).
  const stopLoop = () => {
    clearInterval(timer);
    timer = last = 0;
  };
  const tick = () => {
    const t = performance.now();
    const dt = last ? Math.min(64, t - last) : 16;
    last = t;
    p = holding ? Math.min(1, p + dt / HOLD) : Math.max(0, p - dt / (HOLD / 2.5));
    ritual.style.setProperty('--p', p.toFixed(3));
    if (holding) hint.textContent = HINTS.filter(([at]) => p >= at).pop()[1];
    if (p >= 1 && !done) {
      stopLoop();
      return open();
    }
    if (!holding && p <= 0) stopLoop();
  };
  const run = () => timer || (timer = setInterval(tick, 16));
  const start = (e) => {
    if (done) return;
    e.preventDefault();
    if (!holding) navigator.vibrate?.(8);
    holding = true;
    stage.classList.add('holding');
    run();
  };
  const stop = () => {
    if (!holding || done) return;
    holding = false;
    stage.classList.remove('holding');
    if (p > 0.04) hint.textContent = 'آرام… انگشت را روی کتاب نگه دارید تا دیوان گشوده شود.';
    run();
  };
  async function open() {
    done = true;
    holding = false;
    navigator.vibrate?.([10, 70, 14]);
    stage.classList.remove('holding');
    stage.classList.add('opening');
    hint.textContent = '';
    try {
      const [r] = await Promise.all([call('faal', {}), new Promise((res) => setTimeout(res, reduce ? 250 : 2100))]);
      if (location.hash.startsWith('#/faal')) location.replace(`#/faal/${r.n}`);
    } catch (err) {
      el.view.innerHTML = `<div class="page">${offlineMessage('دیوان فال')}</div>`;
    }
  }

  book.addEventListener('pointerdown', (e) => {
    try {
      book.setPointerCapture(e.pointerId); // keep the hold even if the finger drifts
    } catch (err) {
      /* not an active pointer: hold still works without capture */
    }
    start(e);
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) book.addEventListener(ev, stop);
  book.addEventListener('contextmenu', (e) => e.preventDefault());
  book.addEventListener('keydown', (e) => (e.key === ' ' || e.key === 'Enter') && !e.repeat && start(e));
  book.addEventListener('keyup', (e) => (e.key === ' ' || e.key === 'Enter') && stop());
  cleanup = stopLoop;
}

async function showFaalResult(n) {
  let r;
  try {
    r = await call('faal', { n });
  } catch (err) {
    setHeader({ title: 'فال حافظ' });
    el.view.innerHTML = `<div class="page">${offlineMessage('دیوان فال')}</div>`;
    return;
  }
  const title = `غزل شمارهٔ ${fa(r.n)}`;
  const spec = { title, poet: 'حافظ', section: 'فال حافظ', verses: r.verses, note: r.interpretation };
  const text = `${r.verses.map((v) => v[1]).join('\n')}\n\nتعبیر: ${r.interpretation}\n\nحافظ، فال حافظ، ${title}\nارسال شده از دوست`;
  setHeader({
    title: 'فال حافظ',
    actions: `<button class="icon-btn narrow-only" data-fa="share" aria-label="اشتراک‌گذاری" title="اشتراک‌گذاری">${icon('share')}</button>`,
  });
  el.view.innerHTML = `
    <div class="page poem faal-result">
      <nav class="crumbs"><a href="#/">خانه</a>${icon('next')}<a href="#/faal">فال حافظ</a></nav>
      <header class="poem-head">
        <div class="faal-kicker">${SHAMSEH}<span>فال شما</span></div>
        <h2>${title}</h2>
        <div class="by">حافظ</div>
        <div class="poem-actions wide-only">
          <button class="chip-btn" data-fa="share">${icon('share')} اشتراک</button>
          <button class="chip-btn" data-fa="copy">${icon('copy')} رونوشت</button>
          <a class="chip-btn" href="#/faal">${icon('feather')} نیتی دیگر</a>
        </div>
      </header>
      <article class="verses faal-verses" id="verses">${verseBlocks(r.verses, '')}</article>
      <section class="faal-interp" id="interp">
        <div class="interp-head"><span></span>تعبیر<span></span></div>
        <p>${esc(r.interpretation)}</p>
      </section>
      <div class="faal-again"><a class="btn" href="#/faal">${icon('feather')} نیتی دیگر</a></div>
    </div>`;
  // The ghazal unfolds beyt by beyt, then the interpretation.
  const blocks = [...el.view.querySelectorAll('#verses .b')];
  blocks.forEach((b, i) => (b.style.animationDelay = `${Math.min(i * 0.16, 2.4)}s`));
  $('#interp').style.animationDelay = `${Math.min(blocks.length * 0.16, 2.4) + 0.4}s`;
  fitVerses($('#verses'));
  const onAct = async (e) => {
    const a = e.target.closest('[data-fa]')?.dataset.fa;
    if (a === 'share') openShareSheet(spec);
    if (a === 'copy') {
      await copyText(text);
      toast('فال رونوشت شد');
    }
  };
  el.view.onclick = onAct;
  el.actions.onclick = onAct;
}

// ------------------------------------------------------------------ favorites

async function showFavs(poetId) {
  const all = store.favorites();
  // Older entries may lack poet info: derive it from the category.
  for (const f of all) {
    if (!f.poet_id && catById.has(f.cat_id)) {
      const poet = poets[catById.get(f.cat_id).poetIdx];
      f.poet_id = poet.id;
      f.poet_name = poet.name;
    }
  }
  const groups = new Map();
  for (const f of all) {
    const k = f.poet_id || 0;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  }
  if (poetId != null && groups.has(poetId)) {
    const items = groups.get(poetId);
    setHeader({ title: `نشان‌های ${items[0].poet_name || 'ناشناس'}` });
    el.view.innerHTML = `<div class="page"><div class="card">${items
      .map(
        (f) => `<div class="row" data-open="${f.id}"><span class="grow"><div class="name">${esc(f.title)}</div>
          <div class="sub">${esc([f.book_name, f.section_name].filter(Boolean).join('، ') || 'بدون دسته‌بندی')}</div></span>
          <button class="icon-btn" data-remove="${f.id}" aria-label="برداشتن">${icon('x')}</button></div>`,
      )
      .join('')}</div></div>`;
    el.view.onclick = (e) => {
      const rm = e.target.closest('[data-remove]');
      if (rm) {
        e.stopPropagation();
        store.removeFav(+rm.dataset.remove);
        return store.favorites().some((f) => f.poet_id === poetId) ? showFavs(poetId) : location.replace('#/favs');
      }
      const o = e.target.closest('[data-open]');
      if (o) location.hash = `#/poem/${o.dataset.open}`;
    };
    return;
  }
  setHeader({ title: 'نشان‌ها', back: false });
  el.view.onclick = null;
  el.view.innerHTML = `<div class="page">${
    all.length
      ? `<div class="card">${[...groups]
          .map(
            ([pid, items]) => `<a class="row" href="#/favs/${pid}"><span class="ico">${icon('heart')}</span>
              <span class="grow"><div class="name">${esc(items[0].poet_name || 'ناشناس')}</div><div class="sub">${fa(items.length)} شعر نشان شده</div></span>${icon('next').replace('<svg', '<svg class="chev"')}</a>`,
          )
          .join('')}</div>`
      : `<div class="empty">${icon('heart')}<br/>هیچ شعری را هنوز نشان نکرده‌اید.<br/><small>با دکمهٔ ♥ در صفحهٔ هر شعر آن را نشان کنید.</small></div>`
  }</div>`;
}

// ------------------------------------------------------------------ sheets & settings

function openSheet(html, onReady) {
  el.sheet.innerHTML = html;
  el.sheet.hidden = false;
  el.backdrop.hidden = false;
  el.sheet.onclick = null;
  onReady?.(el.sheet);
}
function closeSheet() {
  el.sheet.hidden = true;
  el.backdrop.hidden = true;
  el.sheet.innerHTML = '';
}
el.backdrop.addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => e.key === 'Escape' && !el.sheet.hidden && closeSheet());

const FONT_SIZES = [
  [0.9, 'کوچک'],
  [1, 'معمولی'],
  [1.15, 'بزرگ'],
  [1.3, 'خیلی بزرگ'],
];

function openSettings() {
  openSheet(
    `<h3>تنظیمات</h3>
     <div class="field-label">پوسته</div>
     <div class="seg" id="seg-theme">${[
       ['auto', 'خودکار'],
       ['light', 'روشن'],
       ['dark', 'تیره'],
     ]
       .map(([v, t]) => `<button data-v="${v}" class="${store.theme() === v ? 'on' : ''}">${t}</button>`)
       .join('')}</div>
     <div class="field-label">اندازهٔ متن شعر</div>
     <div class="seg" id="seg-font">${FONT_SIZES.map(([v, t]) => `<button data-v="${v}" class="${store.setting('font') === v ? 'on' : ''}">${t}</button>`).join('')}</div>
     ${canCache() ? `<div class="field-label">استفادهٔ بدون اینترنت</div>${offlineCard('settings')}` : ''}
     <div class="about"><b>دوست</b> — گنجینهٔ همراه شعر پارسی، کاملاً آفلاین.<br/>
       ${info ? `${fa(poets.length)} شاعر · ${fa(info.poems)} شعر · ${fa(info.verses)} بیت و مصراع` : ''}<br/>
       داده‌ها از گنجور (ganjoor.net).</div>
     <div class="sheet-row"><button class="btn ghost" data-close>بستن</button></div>`,
    (s) => {
      $('#seg-theme', s).onclick = (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        store.setTheme(b.dataset.v);
        applySettings();
        s.querySelectorAll('#seg-theme button').forEach((x) => x.classList.toggle('on', x === b));
      };
      $('#seg-font', s).onclick = (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        store.setSetting('font', +b.dataset.v);
        applySettings();
        s.querySelectorAll('#seg-font button').forEach((x) => x.classList.toggle('on', x === b));
      };
      s.querySelector('[data-close]').onclick = closeSheet;
    },
  );
}
$('#btn-settings').addEventListener('click', openSettings);

// ------------------------------------------------------------------ offline (web / PWA)
// The native and desktop apps ship all data. On the web, poems are cached as they are read;
// this saves everything at once so the PWA works fully offline. Completion is remembered per
// data build, so a data update offers the download again.

const OFFLINE_KEY = 'doost_offline';
const offline = { running: null, done: 0, total: 0, failed: false };
const canCache = () => 'serviceWorker' in navigator && 'caches' in window && !isNative && !isElectron && location.protocol === 'https:';
function offlineReady() {
  try {
    return !!info && localStorage.getItem(OFFLINE_KEY) === info.build;
  } catch (e) {
    return false;
  }
}
const offlineLater = () => {
  try {
    return sessionStorage.getItem('doost_offline_later') === '1';
  } catch (e) {
    return false;
  }
};

// The offline call-to-action, shown on the home page, in Settings and in offline errors.
function offlineCard(context) {
  if (!canCache()) return '';
  if (offlineReady())
    return context === 'settings' ? `<div class="offline-ok">${icon('check')} همهٔ اشعار برای استفادهٔ بدون اینترنت ذخیره شده است.</div>` : '';
  if (context === 'home' && offlineLater() && !offline.running) return '';
  const pct = offline.total ? Math.round((100 * offline.done) / offline.total) : 0;
  return `<div class="offline-card" data-offline-card="${context}">
      <div class="oc-text"><b>${icon('book')} استفادهٔ بدون اینترنت</b>
        <span>${offline.failed ? 'دریافت کامل نشد؛ دوباره تلاش کنید.' : 'همهٔ اشعار (حدود ۶۳ مگابایت) را یک‌بار دریافت کنید تا دوست بدون اینترنت هم کامل کار کند.'}</span></div>
      <div class="progress" ${offline.running ? '' : 'hidden'}><span data-offline-bar style="width:${pct}%"></span></div>
      <div class="oc-actions">
        <button class="btn" data-offline-start ${offline.running ? 'disabled' : ''}>${offline.running ? `در حال دریافت… ${fa(pct)}٪` : 'دریافت همهٔ اشعار'}</button>
        ${context === 'home' && !offline.running ? '<button class="btn ghost" data-offline-later>بعداً</button>' : ''}
      </div>
    </div>`;
}

function refreshOfflineCards() {
  document.querySelectorAll('[data-offline-card]').forEach((c) => {
    const html = offlineCard(c.dataset.offlineCard);
    if (html) c.outerHTML = html;
    else c.remove();
  });
}

function startOfflineDownload() {
  if (offline.running) return offline.running;
  offline.failed = false;
  offline.running = (async () => {
    navigator.storage?.persist?.().catch(() => {}); // ask the browser not to evict it
    const meta = await fetch('data/meta.json', { cache: 'no-cache' }).then((r) => r.json());
    const files = ['data/catalog.txt', 'data/poems.txt', 'data/bios.txt'];
    for (let i = 0; i < meta.blockStarts.length; i++) files.push(`data/v/${i}.txt`);
    for (let i = 0; i < meta.shards; i++) files.push(`data/t/${i}.txt`);
    for (let i = 0; i < files.length; i++) files[i] += `?v=${meta.build}`;
    if (meta.faal) files.push(`data/faal.txt?f=${meta.faal.v}&v=${meta.build}`);
    offline.total = files.length;
    offline.done = 0;
    const cache = await caches.open('doost-data-v1');
    let failed = 0;
    let lastPaint = 0;
    const next = async () => {
      while (files.length) {
        const f = files.pop();
        try {
          if (!(await cache.match(f))) {
            const res = await fetch(f);
            if (res.ok) await cache.put(f, res);
            else failed++;
          }
        } catch (e) {
          failed++;
        }
        offline.done++;
        if (performance.now() - lastPaint > 150) {
          lastPaint = performance.now();
          const pct = Math.round((100 * offline.done) / offline.total);
          document.querySelectorAll('[data-offline-bar]').forEach((b) => (b.style.width = `${pct}%`));
          document.querySelectorAll('[data-offline-start]').forEach((b) => (b.textContent = `در حال دریافت… ${fa(pct)}٪`));
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, next));
    if (failed) throw new Error(`${failed} files failed`);
    try {
      localStorage.setItem(OFFLINE_KEY, meta.build);
    } catch (e) {
      /* storage unavailable: the card will just reappear */
    }
  })()
    .then(() => toast('همهٔ اشعار برای استفادهٔ بدون اینترنت ذخیره شد'))
    .catch(() => {
      offline.failed = true;
      toast('دریافت کامل نشد؛ اتصال اینترنت را بررسی کنید');
    })
    .finally(() => {
      offline.running = null;
      refreshOfflineCards();
    });
  refreshOfflineCards();
  return offline.running;
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-offline-start]')) startOfflineDownload();
  if (e.target.closest('[data-offline-later]')) {
    try {
      sessionStorage.setItem('doost_offline_later', '1');
    } catch (err) {
      /* ignore */
    }
    e.target.closest('[data-offline-card]')?.remove();
  }
});

// Shown when something isn't available offline yet.
function offlineMessage(what) {
  return `<div class="empty">${icon('book')}<br/>${what} هنوز برای استفادهٔ بدون اینترنت ذخیره نشده است.<br/><small>به اینترنت وصل شوید، یا همهٔ اشعار را یک‌بار دریافت کنید.</small></div>${offlineCard('inline')}`;
}

// ------------------------------------------------------------------ start

applySettings();
call('init')
  .then((r) => {
    info = r;
    poets = r.poets;
    cats = r.cats;
    for (const p of poets) {
      poetById.set(p.id, p);
      poetByName.set(p.name, p);
    }
    for (const c of cats) catById.set(c.id, c);
    $('#splash').classList.add('hide');
    setTimeout(() => $('#splash').remove(), 400);
    route();
    if ('caches' in window && !isNative && !isElectron) {
      caches
        .open('doost-data-v1')
        .then((c) => c.keys().then((keys) => keys.forEach((k) => !k.url.endsWith(`v=${r.build}`) && !k.url.endsWith("meta.json") && c.delete(k))))
        .catch(() => {});
    }
  })
  .catch((err) => {
    $('#splash').innerHTML = `<p style="padding:20px;text-align:center">بارگذاری داده‌ها ناموفق بود.<br/><small>${esc(err.message)}</small></p>`;
  });

if ('serviceWorker' in navigator && location.protocol === 'https:' && !isNative && !isElectron) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Android hardware back button: in-app back, exit from the home screen.
if (isNative) {
  plugin('App')?.addListener('backButton', () => {
    const h = location.hash || '#/';
    if (!el.sheet.hidden) return closeSheet();
    if (h === '#/' || h === '#') plugin('App').exitApp();
    else goBack();
  });
}
