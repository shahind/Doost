// On-device persistence. The first three keys are shared with earlier Doost versions so
// existing favorites, featured poets and theme carry over unchanged.
const K = {
  fav: 'doost_favorites', // [{ id, title, cat_id, poet_id, poet_name, book_name, section_name }]
  selected: 'doost_selected_poets', // [poet name]
  theme: 'doost_theme', // 'dark' | 'light' (absent = follow the system)
  settings: 'doost_settings', // { font }
  recent: 'doost_recent', // [{ id, title, poet }] most recent first
  last: 'doost_last', // { id, title, poet, scroll }
  searches: 'doost_searches', // [query]
};
const DEFAULT_SELECTED = ['حافظ', 'سعدی', 'فردوسی', 'نظامی', 'مولانا', 'مولوی', 'خیام', 'رودکی', 'عطار'];

const read = (k, fallback) => {
  try {
    const v = JSON.parse(localStorage.getItem(k));
    return v ?? fallback;
  } catch (e) {
    return fallback;
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch (e) {
    /* storage full or unavailable: keep going in memory */
  }
};

let favs = read(K.fav, []);
if (!Array.isArray(favs)) favs = [];
let selected = read(K.selected, DEFAULT_SELECTED);
if (!Array.isArray(selected)) selected = DEFAULT_SELECTED;

export const favorites = () => favs;
export const isFav = (id) => favs.some((f) => f.id === id);
export function toggleFav(item) {
  const i = favs.findIndex((f) => f.id === item.id);
  if (i >= 0) favs.splice(i, 1);
  else favs.unshift(item);
  write(K.fav, favs);
  return i < 0;
}
export function removeFav(id) {
  favs = favs.filter((f) => f.id !== id);
  write(K.fav, favs);
}

export const selectedPoets = () => selected;
export const isSelected = (name) => selected.includes(name);
export function toggleSelected(name) {
  selected = isSelected(name) ? selected.filter((n) => n !== name) : [...selected, name];
  write(K.selected, selected);
  return selected.includes(name);
}

export function theme() {
  try {
    const t = localStorage.getItem(K.theme);
    return t === 'dark' || t === 'light' ? t : 'auto';
  } catch (e) {
    return 'auto';
  }
}
export function setTheme(t) {
  try {
    if (t === 'auto') localStorage.removeItem(K.theme);
    else localStorage.setItem(K.theme, t);
  } catch (e) {
    /* ignore */
  }
}

const settings = { font: 1, ...read(K.settings, {}) };
export const setting = (k) => settings[k];
export function setSetting(k, v) {
  settings[k] = v;
  write(K.settings, settings);
}

export const recent = () => read(K.recent, []);
export function addRecent(item) {
  write(K.recent, [item, ...recent().filter((r) => r.id !== item.id)].slice(0, 30));
}
export const lastRead = () => read(K.last, null);
export const setLastRead = (v) => write(K.last, v);

export const searches = () => read(K.searches, []);
export function addSearch(q) {
  q = q.trim();
  if (q.length < 2) return;
  write(K.searches, [q, ...searches().filter((s) => s !== q)].slice(0, 12));
}
export const clearSearches = () => write(K.searches, []);
