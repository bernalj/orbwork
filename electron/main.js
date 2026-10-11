// Orbwork desktop (Steam) shell: one window running the same index.html as the web build.
const { app, BrowserWindow, ipcMain, Menu, shell, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const steam = require('./steam');
const { earned } = require('./achievements');

const DEV = !app.isPackaged;
const ON_DECK = process.env.SteamDeck === '1';

steam.preReady();
if (!app.requestSingleInstanceLock()) app.quit();

/* ---------- files in %APPDATA%/Orbwork ---------- */
// The save lives on its own in saves/ so Steam Auto-Cloud can sync just that folder.
const saveDir = () => path.join(app.getPath('userData'), 'saves');
const saveFile = () => path.join(saveDir(), 'save.json');
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

let settings = { fullscreen: false, bounds: null };
let lastSave = null;
let win = null;

/* ---------- window ---------- */
function boundsVisible(b) {
  return b && screen.getAllDisplays().some(d => {
    const a = d.workArea;
    return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
  });
}

// First launch: windowed, 1080 wide (or less on small screens), 3:2, centered on the primary display.
function defaultBounds() {
  const a = screen.getPrimaryDisplay().workArea;
  const width = Math.min(1080, a.width - 40), height = Math.min(Math.round(width * 2 / 3), a.height - 40);
  return { width, height, x: a.x + Math.round((a.width - width) / 2), y: a.y + Math.round((a.height - height) / 2) };
}

function createWindow() {
  const b = boundsVisible(settings.bounds) ? settings.bounds : defaultBounds();
  win = new BrowserWindow({
    ...b,
    minWidth: 640,
    minHeight: 480,
    title: 'Orbwork',
    backgroundColor: '#170f28',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    fullscreen: ON_DECK || settings.fullscreen,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      devTools: DEV || !!process.env.ORBWORK_DEVTOOLS,
    },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());

  // Keep the game self-contained: no navigation away, links open in the real browser.
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) { toggleFullscreen(); e.preventDefault(); }
    else if (input.key === 'F12' && (DEV || process.env.ORBWORK_DEVTOOLS)) { win.webContents.toggleDevTools(); e.preventDefault(); }
  });

  const remember = () => {
    if (win.isFullScreen() || win.isMaximized() || win.isMinimized()) return;
    settings.bounds = win.getBounds();
  };
  win.on('resize', remember);
  win.on('move', remember);
  win.on('close', () => { try { writeAtomic(settingsFile(), JSON.stringify(settings)); } catch {} });

  win.loadFile(path.join(__dirname, '..', 'index.html'));
}

function toggleFullscreen() {
  if (win) setFullscreen(!win.isFullScreen());
}
function setFullscreen(next) {
  if (!win) return;
  win.setFullScreen(next);
  if (ON_DECK) return;
  settings.fullscreen = next;
  try { writeAtomic(settingsFile(), JSON.stringify(settings)); } catch {}
}

/* ---------- bridge to the game (see preload.js) ---------- */
ipcMain.on('save:load', e => {
  try { e.returnValue = fs.readFileSync(saveFile(), 'utf8'); } catch { e.returnValue = null; }
});
// Synchronous so the last save before closing (Alt+F4, Quit button) always lands.
ipcMain.on('save:write', (e, json) => {
  e.returnValue = true;
  if (typeof json !== 'string' || json === lastSave) return;
  try { writeAtomic(saveFile(), json); lastSave = json; } catch (err) { console.error('[save] write failed:', err.message); }
});
ipcMain.on('progress', (_e, progress) => {
  for (const id of earned(progress)) steam.unlock(id);
});
ipcMain.on('fullscreen:toggle', toggleFullscreen);
ipcMain.on('fullscreen:set', (_e, on) => setFullscreen(!!on));
ipcMain.on('fullscreen:get', e => { e.returnValue = !!win && win.isFullScreen(); });
ipcMain.on('app:version', e => { e.returnValue = require('../package.json').version; });
ipcMain.on('app:quit', () => app.quit());

/* ---------- lifecycle ---------- */
app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  if (steam.relaunchedThroughSteam()) return app.quit();
  settings = { ...settings, ...readJSON(settingsFile(), {}) };
  steam.init();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
