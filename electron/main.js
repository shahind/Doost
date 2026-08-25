const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

// The web app fetches absolute-root paths at runtime (e.g. /ganjoor.s3db), which
// break under file:// (there's no "site root" for that protocol). Serving the built
// assets over a local HTTP server instead makes them resolve exactly like they do in
// the Vite dev server or a real web deployment.
const DIST_DIR = path.join(__dirname, 'app');

// Fixed, not random: localStorage (favorites, dark mode, etc.) is scoped per-origin,
// which includes the port. A random port every launch meant every launch was a brand
// new origin with empty storage - that's why nothing ever persisted. Pairing this with
// requestSingleInstanceLock below means only one process ever binds it.
const SERVER_PORT = 47893;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.s3db': 'application/octet-stream',
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      let filePath = path.join(DIST_DIR, urlPath);
      if (!filePath.startsWith(DIST_DIR)) filePath = DIST_DIR;
      if (urlPath === '/' || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(DIST_DIR, 'index.html');
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(SERVER_PORT, '127.0.0.1', () => resolve(server.address().port));
  });
}

let mainWindow;

async function createWindow() {
  const port = await startServer();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 480,
    minHeight: 640,
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#35646A', // matches the app's splash screen background
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

// Only one process should ever bind SERVER_PORT. If a second launch happens while
// the app is already running, hand off to the existing window instead of starting
// a second server that would just fail to bind the port.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(createWindow);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
