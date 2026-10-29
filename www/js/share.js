// "Share as picture": draws a poem (or one beyt) on a canvas and hands the PNG to the
// system share sheet (Capacitor on Android/iOS, Web Share on phones) or saves it (desktop).
import { isNative, plugin } from './platform.js';

const W = 1080;
const PAD = 80;
const C = { bg: '#faf4ed', teal: '#35646a', text: '#373232', muted: '#8b847f', line: '#e6dccf' };
const MAX_LINES = 64; // longer poems are cut with "…"

const loadImage = (src) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

// Groups verses ([position, text]) into rows: beyts (two half-lines) and single lines.
function rows(verses) {
  const out = [];
  for (let k = 0; k < verses.length; ) {
    const [pos, text] = verses[k];
    if (pos === 0 && verses[k + 1]?.[0] === 1) {
      out.push({ kind: 'beyt', lines: [text, verses[k + 1][1]] });
      k += 2;
    } else {
      out.push({ kind: pos === 5 || pos === -1 ? 'prose' : 'single', lines: [text] });
      k++;
    }
  }
  return out;
}

function wrap(ctx, text, maxW) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

export async function renderPoemImage({ title, poet, verses }) {
  await Promise.all([
    document.fonts.load('700 56px Amiri'),
    document.fonts.load('46px Amiri'),
    document.fonts.load('30px Estedad'),
    document.fonts.load('700 30px Estedad'),
  ]);
  const logo = await loadImage('icons/logo.png');
  const measure = document.createElement('canvas').getContext('2d');
  measure.direction = 'rtl';

  // Layout pass: a list of draw operations with y positions.
  const ops = [];
  let y = 170 + 70;
  const inner = W - PAD * 2;
  ops.push({ font: '700 56px Amiri', color: C.teal, align: 'center', x: W / 2, y, text: title, fit: inner });
  y += 64;
  ops.push({ font: '30px Estedad', color: C.muted, align: 'center', x: W / 2, y, text: poet });
  y += 46;
  ops.push({ rule: true, y });
  y += 84;

  let count = 0;
  const all = rows(verses);
  for (const r of all) {
    if (count >= MAX_LINES) {
      ops.push({ font: '46px Amiri', color: C.muted, align: 'center', x: W / 2, y, text: '…' });
      y += 70;
      break;
    }
    if (r.kind === 'beyt') {
      // Staggered couplet; both half-lines share one size that fits the wider of the two.
      const maxW = inner - 110;
      let size = 46;
      measure.font = `${size}px Amiri`;
      const widest = Math.max(...r.lines.map((t) => measure.measureText(t).width));
      if (widest > maxW) size = Math.max(30, Math.floor((size * maxW) / widest));
      ops.push({ font: `${size}px Amiri`, color: C.text, align: 'right', x: W - PAD, y, text: r.lines[0] });
      y += 74;
      ops.push({ font: `${size}px Amiri`, color: C.text, align: 'left', x: PAD, y, text: r.lines[1] });
      y += 96;
      count += 2;
    } else {
      const prose = r.kind === 'prose';
      const font = prose ? '38px Amiri' : '46px Amiri';
      measure.font = font;
      for (const line of wrap(measure, r.lines[0], inner)) {
        ops.push({ font, color: prose ? C.muted : C.text, align: prose ? 'right' : 'center', x: prose ? W - PAD : W / 2, y, text: line });
        y += prose ? 62 : 74;
        count++;
      }
      y += 22;
    }
  }
  y += 10;
  ops.push({ rule: true, y });
  y += 70;
  ops.push({ font: '700 30px Estedad', color: C.teal, align: 'center', x: W / 2, y, text: 'دوست · گنجینه همراه شعر پارسی' });
  const H = y + 70;

  // Draw pass.
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.direction = 'rtl';
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.teal;
  ctx.fillRect(0, 0, W, 170);
  ctx.fillRect(0, H - 14, W, 14);
  if (logo) {
    const h = 104;
    const w = (logo.width / logo.height) * h;
    ctx.drawImage(logo, (W - w) / 2, (170 - h) / 2, w, h);
  }
  ctx.textBaseline = 'alphabetic';
  for (const op of ops) {
    if (op.rule) {
      ctx.fillStyle = C.line;
      ctx.fillRect(W / 2 - 160, op.y, 320, 3);
      ctx.fillStyle = C.teal;
      ctx.beginPath();
      ctx.arc(W / 2, op.y + 1.5, 7, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.font = op.font;
    if (op.fit) {
      let size = parseInt(op.font.match(/(\d+)px/)[1], 10);
      while (size > 32 && ctx.measureText(op.text).width > op.fit) ctx.font = op.font.replace(/\d+px/, `${(size -= 2)}px`);
    }
    ctx.fillStyle = op.color;
    ctx.textAlign = op.align;
    ctx.fillText(op.text, op.x, op.y);
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'));
}

const toBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });

/** Returns 'shared', 'saved' or 'cancelled'. */
export async function shareImage(blob, name, title) {
  const isCancel = (e) => e && (e.name === 'AbortError' || /cancel/i.test(e.message || ''));
  if (isNative) {
    const { uri } = await plugin('Filesystem').writeFile({ path: name, data: await toBase64(blob), directory: 'CACHE' });
    try {
      await plugin('Share').share({ title, files: [uri], dialogTitle: title });
      return 'shared';
    } catch (e) {
      if (isCancel(e)) return 'cancelled';
      throw e;
    }
  }
  // Phones (touch): the system share sheet. Desktop: save the PNG.
  const file = new File([blob], name, { type: 'image/png' });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if (isCancel(e)) return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'saved';
}
