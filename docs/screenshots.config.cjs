// README screenshots: npx electron tools/store-assets.cjs docs/screenshots.config.cjs
const { scenes } = require('../store/assets.config.cjs');
const scene = (name) => scenes.find((s) => s.name === name);
const desktop = { width: 1280, height: 800, scale: 1, mobile: false };
const phone = { width: 360, height: 740, scale: 2 };

module.exports = {
  out: 'docs/screenshots',
  shots: [
    { ...scene('poem'), ...desktop, name: 'desktop' },
    { ...scene('home'), ...phone, name: 'mobile-home' },
    { ...scene('poem'), ...phone, name: 'mobile-poem' },
    { ...scene('faal-result'), ...phone, name: 'mobile-faal' },
  ],
};
