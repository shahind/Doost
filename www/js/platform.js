// Platform helpers: clipboard and share across web, Capacitor (Android/iOS) and Electron.
const cap = typeof window !== 'undefined' ? window.Capacitor : undefined;
export const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
export const isElectron = typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent);

// Native plugin proxy (requires js/vendor/capacitor.js, the @capacitor/core runtime).
const plugins = {};
export function plugin(name) {
  if (!isNative) return null;
  if (!(name in plugins)) {
    plugins[name] = (cap.Plugins && cap.Plugins[name]) || (cap.registerPlugin ? cap.registerPlugin(name) : null);
  }
  return plugins[name];
}

export async function copyText(text) {
  const clip = plugin('Clipboard');
  if (clip) {
    await clip.write({ string: text });
    return true;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0;top:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/** Returns 'shared', 'copied' or 'cancelled'. */
export async function shareText(title, text) {
  const share = plugin('Share');
  try {
    if (share) {
      await share.share({ title, text, dialogTitle: title });
      return 'shared';
    }
    if (navigator.share) {
      await navigator.share({ title, text });
      return 'shared';
    }
  } catch (e) {
    if (e && (e.name === 'AbortError' || /cancel/i.test(e.message || ''))) return 'cancelled';
  }
  await copyText(text);
  return 'copied';
}

// Opens a word in Yaad (the Dehkhoda dictionary app): the installed Yaad app if there is one
// (yaad://), otherwise Yaad's web version — which, on Android, an installed Yaad PWA can capture.
const YAAD_WEB = 'https://shahind.github.io/Yaad/';
export async function lookupInYaad(word) {
  const q = encodeURIComponent(word.trim());
  const web = `${YAAD_WEB}#/?q=${q}`; // Yaad shows its search results for the word
  if (isNative) {
    const launcher = plugin('AppLauncher');
    const app = `yaad://search?q=${q}`;
    try {
      // Android checks the package; iOS checks the URL scheme (declared in Info.plist).
      const probe = cap.getPlatform() === 'android' ? 'io.github.shahind.yaad' : 'yaad://';
      const { value } = await launcher.canOpenUrl({ url: probe });
      if (value) {
        await launcher.openUrl({ url: app });
        return 'app';
      }
    } catch (e) {
      /* fall through to the web version */
    }
    try {
      await launcher.openUrl({ url: web });
      return 'web';
    } catch (e) {
      /* fall through */
    }
  }
  window.open(web, '_blank', 'noopener');
  return 'web';
}
