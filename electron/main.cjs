// Electron shell for Windows / Linux. Serves www/ over a local HTTP server on a FIXED port:
// localStorage (favorites, featured poets, theme) is scoped per origin, so the origin must
// stay http://127.0.0.1:47893 — the same one earlier Doost versions used — or users would
// lose their data. requestSingleInstanceLock guarantees only one process binds the port.
const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');

// The profile folder holds localStorage too: keep the one earlier versions used.
app.setPath('userData', path.join(app.getPath('appData'), 'doost-desktop'));

const ROOT = path.join(__dirname, '..', 'www');
const PORT = 47893;
const CSP =
  "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'";
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain', // data files: .txt so download managers (IDM…) leave them alone
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.normalize(path.join(ROOT, p));
      if (!file.startsWith(ROOT)) return res.writeHead(403).end();
      // fs.readFile works inside app.asar as well.
      fs.readFile(file, (err, data) => {
        if (err) return res.writeHead(404).end('not found');
        res.writeHead(200, {
          'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
          'Content-Security-Policy': CSP,
          'Cache-Control': 'no-cache',
        });
        res.end(data);
      });
    });
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
}

let win;
async function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    title: 'دوست',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#35646a',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.loadURL(`http://127.0.0.1:${PORT}/`);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url) && !url.startsWith(`http://127.0.0.1:${PORT}`)) shell.openExternal(url);
    return { action: 'deny' };
  });
  if (process.env.DOOST_SMOKE) {
    win.webContents.once('did-finish-load', () =>
      setTimeout(async () => {
        const r = await win.webContents.executeJavaScript(
          `document.querySelector('#splash') ? 'loading' : 'ready:' + document.querySelectorAll('.poet').length + ' poets, favorites=' + JSON.parse(localStorage.getItem('doost_favorites') || '[]').length + ', theme=' + localStorage.getItem('doost_theme')`,
        );
        console.log('smoke:', r);
        app.quit();
      }, 4000),
    );
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    await startServer();
    createWindow();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
}
