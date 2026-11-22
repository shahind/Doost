// Applies the saved theme and reading size before first paint (classic script, runs sync).
// Keys are shared with earlier Doost versions so existing users keep their settings.
try {
  var t = localStorage.getItem('doost_theme');
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
  var s = JSON.parse(localStorage.getItem('doost_settings') || '{}');
  if (s.font) document.documentElement.style.setProperty('--poem-scale', s.font);
} catch (e) {}
