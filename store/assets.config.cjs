// Scenes for the Google Play screenshots and feature graphic (run tools/store-assets.cjs).
const last = { doost_last: { id: 2130, title: 'غزل شمارهٔ ۱', poet: 'حافظ', scroll: 0 } };

module.exports = {
  out: 'store/play',
  brand: {
    font: 'Estedad',
    fonts: [
      ['Estedad', 'Estedad-Regular.woff2', 400],
      ['Estedad', 'Estedad-Bold.woff2', 700],
    ],
    background: 'linear-gradient(160deg, #35646a, #1f4246)',
  },
  scenes: [
    { name: 'home', hash: '#/', storage: last, caption: 'گنجینهٔ همراه شعر پارسی', sub: '۲۳۷ شاعر و ۱۳۳ هزار شعر، بی‌نیاز از اینترنت' },
    { name: 'poem', hash: '#/poem/2130', storage: last, wait: 4500, caption: 'شعر، زیبا و خوانا', sub: 'اشتراک بیت یا کل شعر، به‌صورت متن یا تصویر' },
    { name: 'search', hash: '#/search?q=' + encodeURIComponent('عشق'), storage: last, wait: 6000, setup: "const h = document.querySelector('#verse-section'); const v = document.querySelector('#view'); if (h) v.scrollTop += h.getBoundingClientRect().top - 150;", caption: 'جستجو در سه میلیون بیت', sub: 'نام شاعر، عنوان شعر یا بخشی از یک بیت' },
    { name: 'faal', hash: '#/faal', storage: last, wait: 6000, caption: 'فال حافظ', sub: 'نیت کنید و دیوان حافظ را بگشایید' },
    {
      name: 'faal-result',
      hash: '#/faal/1',
      storage: last,
      theme: 'dark',
      wait: 6500,
      setup: "const v = document.querySelector('#view'); v.scrollTop = v.scrollHeight;",
      caption: 'غزل و تعبیر فال',
      sub: 'با پوستهٔ تیره و روشن',
    },
  ],
  feature: {
    css: `html,body{margin:0;width:1024px;height:500px;overflow:hidden}
      body{background:linear-gradient(135deg,#35646a,#1f4246);font-family:'Estedad';color:#fff;display:flex;align-items:center;justify-content:center;gap:70px;padding:0 70px;box-sizing:border-box}
      img{width:340px;flex:none;filter:drop-shadow(0 12px 30px rgba(0,0,0,.25))}
      .t{border-right:2px solid rgba(255,255,255,.35);padding-right:60px}
      p{margin:0;font-size:40px;font-weight:700;line-height:1.6;white-space:nowrap}
      small{display:block;margin-top:14px;font-size:24px;opacity:.85;line-height:1.8}`,
    // No «·» next to Persian digits: it reads as a Persian zero (۰).
    html: `<img src="/icons/logo.png"><div class="t"><p>۲۳۷ شاعر، ۱۳۳ هزار شعر</p><small>جستجو در سه میلیون بیت، فال حافظ<br>کاملاً آفلاین</small></div>`,
  },
};
