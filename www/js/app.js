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
  const parts = [`<a href="#/poet/${poet.id}">${esc(poet.name)}</a>`];
  const inner = path.slice(1, includeLast ? undefined : -1);
  for (const c of inner) parts.push(`<a href="#/cat/${c.id}">${esc(c.title)}</a>`);
  return `<nav class="crumbs">${parts.join(icon('next'))}</nav>`;
}
const poetTint = (p) => `t${p.id % 4}`;

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
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySettings);

// ------------------------------------------------------------------ navigation

const scrolls = new Map();
const stack = []; // visited hashes, to tell "back" from "forward"
let routeKey = '';
let cleanup = null;

function setHeader({ title = '', actions = '', back = true }) {
  el.title.textContent = title;
  el.brand.hidden = !!title;
  el.actions.innerHTML = actions;
  el.back.hidden = !back;
}

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
    <div class="page">
      <a class="hero-search" href="#/search">${icon('search')}<span>جستجو در شاعران، عنوان‌ها و ابیات…</span></a>
      ${
        last
          ? `<a class="continue" href="#/poem/${last.id}?resume=1">${icon('book')}<span class="grow"><small>ادامهٔ خواندن · ${esc(last.poet)}</small><b>${esc(last.title)}</b></span>${icon('next')}</a>`
          : ''
      }
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
      document.getElementById('L-' + letter.dataset.letter)?.scrollIntoView({ behavior: 'smooth' });
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
    actions: `<a class="icon-btn" href="#/search?poet=${poet.id}" title="جستجو در آثار" aria-label="جستجو در آثار">${icon('search')}</a>
              <button class="icon-btn" id="act-random" title="شعر تصادفی" aria-label="شعر تصادفی">${icon('shuffle')}</button>`,
  });
  const own = await call('catPoems', { cat: root.idx });
  el.view.innerHTML = `
    <div class="page">
      <section class="poet-hero">
        <h2>${esc(poet.name)}</h2>
        <div class="stat">${fa(poet.poemCount)} شعر${root.children.length ? ` در ${fa(root.children.length)} بخش` : ''}</div>
        <div class="bio" id="bio"></div>
        <div class="hero-actions">
          <a class="chip-btn primary" href="#/search?poet=${poet.id}">${icon('search')} جستجو در آثار</a>
          <button class="chip-btn" data-random>${icon('shuffle')} شعر تصادفی</button>
          <button class="chip-btn ${store.isSelected(poet.name) ? 'on' : ''}" data-star>${icon('star')} منتخب</button>
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
  bios ??= await call('bios');
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
    actions: `<a class="icon-btn" href="#/search?cat=${c.id}" title="جستجو در این بخش" aria-label="جستجو در این بخش">${icon('search')}</a>
              <button class="icon-btn" id="act-random" title="شعر تصادفی" aria-label="شعر تصادفی">${icon('shuffle')}</button>`,
  });
  const own = await call('catPoems', { cat: c.idx });
  el.view.innerHTML = `
    <div class="page">
      ${crumbs(c.idx, { includeLast: false })}
      ${c.children.length ? `<div class="section-title">${icon('folder')} بخش‌ها</div><div class="card">${catRows(c.children)}</div>` : ''}
      ${own.length ? `<div class="section-title">${icon('book')} اشعار <span class="count">${fa(own.length)}</span></div><div class="card" id="poem-list">${poemRows(own)}</div>` : ''}
      ${!own.length && !c.children.length ? `<div class="empty">محتوایی در این بخش یافت نشد.</div>` : ''}
    </div>`;
  mountPoemList(own);
  $('#act-random').onclick = () => randomPoem({ cat: c.idx });
  el.view.onclick = null;
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
  const p = await call('poem', { id });
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
  setHeader({
    title: p.title,
    actions: `<button class="icon-btn ${isFav ? 'on' : ''}" id="act-fav" aria-label="نشان" title="نشان">${icon('heart')}</button>
              <button class="icon-btn" id="act-share" aria-label="اشتراک‌گذاری" title="اشتراک‌گذاری">${icon('share')}</button>`,
  });
  el.view.innerHTML = `
    <div class="page poem ${dir ? 'slide-' + dir : ''}">
      ${crumbs(p.catIdx)}
      <header class="poem-head">
        <h2>${esc(p.title)}</h2>
        <div class="by">${esc(poet.name)}</div>
        <div class="poem-actions">
          <button class="chip-btn ${isFav ? 'on' : ''}" data-act="fav">${icon('heart')} <span>${isFav ? 'نشان‌شده' : 'نشان'}</span></button>
          <button class="chip-btn" data-act="share">${icon('share')} اشتراک</button>
          <button class="chip-btn" data-act="copy">${icon('copy')} رونوشت</button>
          <a class="chip-btn" href="#/search?cat=${cats[p.catIdx].id}">${icon('search')} جستجو در این بخش</a>
          <button class="chip-btn" data-act="font">${icon('text')} اندازهٔ متن</button>
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
    $('#act-fav').classList.toggle('on', on);
    const chip = el.view.querySelector('[data-act="fav"]');
    chip.classList.toggle('on', on);
    chip.querySelector('span').textContent = on ? 'نشان‌شده' : 'نشان';
    toast(on ? 'به نشان‌ها افزوده شد' : 'از نشان‌ها برداشته شد');
  };
  const share = async () => {
    if ((await shareText(p.title, poemText(p, p.verses))) === 'copied') toast('متن شعر رونوشت شد');
  };
  $('#act-fav').onclick = toggleFav;
  $('#act-share').onclick = share;

  const versesEl = $('#verses');
  el.view.onclick = async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'fav') return toggleFav();
    if (act === 'share') return share();
    if (act === 'copy') {
      await copyText(poemText(p, p.verses));
      return toast('متن شعر رونوشت شد');
    }
    if (act === 'font') return openSettings();
    const tool = e.target.closest('[data-vt]');
    if (tool) {
      const b = tool.closest('.b');
      const k = +b.dataset.v;
      const lines = p.verses.slice(k, k + +b.dataset.n).map((v) => v[1]);
      const text = `${lines.join('\n')}\n\n${poet.name}، ${p.title}\nارسال شده از دوست`;
      if (tool.dataset.vt === 'copy') {
        await copyText(text);
        toast('بیت رونوشت شد');
      } else if ((await shareText(p.title, text)) === 'copied') toast('بیت رونوشت شد');
      clearVerseTools();
      return;
    }
    // Tap a verse (without selecting text) to get copy/share for just that beyt.
    const b = e.target.closest('.b');
    if (b && !String(getSelection()).trim()) {
      const was = b.classList.contains('sel');
      clearVerseTools();
      if (!was) {
        b.classList.add('sel');
        b.insertAdjacentHTML(
          'afterbegin',
          `<div class="verse-tools"><button data-vt="copy">${icon('copy')} رونوشت بیت</button><button data-vt="share">${icon('share')} اشتراک بیت</button></div>`,
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
  if (focus) {
    focus.classList.add('focus');
    scrolls.delete(routeKey);
    requestAnimationFrame(() => focus.scrollIntoView({ block: 'center' }));
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

async function loadVerses(seq, first) {
  if (search.loading && !first) return;
  search.loading = true;
  const r = await call('verses', { q: search.q, scope: search.scope, cursor: first ? 0 : search.cursor }).finally(() => (search.loading = false));
  if (seq !== search.seq) return;
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
  const canCache = 'serviceWorker' in navigator && 'caches' in window && !isNative && !isElectron && location.protocol === 'https:';
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
     ${
       canCache
         ? `<div class="field-label">استفادهٔ آفلاین در مرورگر</div>
            <button class="btn ghost" id="dl-all" style="width:100%">بارگیری همهٔ اشعار (حدود ۶۳ مگابایت)</button>
            <div class="progress" id="dl-progress" hidden><span></span></div>`
         : ''
     }
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
      $('#dl-all', s)?.addEventListener('click', downloadAll);
      s.querySelector('[data-close]').onclick = closeSheet;
    },
  );
}
$('#btn-settings').addEventListener('click', openSettings);

// Web only: put every data file in the service-worker cache.
async function downloadAll() {
  const btn = $('#dl-all');
  const bar = $('#dl-progress');
  btn.disabled = true;
  bar.hidden = false;
  const meta = await fetch('data/meta.json', { cache: 'no-cache' }).then((r) => r.json());
  const files = ['data/catalog.bin', 'data/poems.bin', 'data/bios.bin'];
  for (let i = 0; i < meta.blockStarts.length; i++) files.push(`data/v/${i}.bin`);
  for (let i = 0; i < meta.shards; i++) files.push(`data/t/${i}.bin`);
  for (let i = 0; i < files.length; i++) files[i] += `?v=${meta.build}`;
  const cache = await caches.open('doost-data-v1');
  let done = 0;
  const next = async () => {
    while (files.length) {
      const f = files.pop();
      if (!(await cache.match(f))) {
        const res = await fetch(f);
        if (res.ok) await cache.put(f, res);
      }
      done++;
      bar.firstElementChild.style.width = `${(100 * done) / (done + files.length)}%`;
    }
  };
  try {
    await Promise.all(Array.from({ length: 6 }, next));
    btn.textContent = 'همهٔ اشعار برای استفادهٔ آفلاین ذخیره شد ✓';
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'خطا در بارگیری؛ دوباره تلاش کنید';
  }
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
        .then((c) => c.keys().then((keys) => keys.forEach((k) => !k.url.endsWith(`v=${r.build}`) && c.delete(k))))
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
