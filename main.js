const { app, BrowserWindow, ipcMain, screen, dialog, globalShortcut, session } = require('electron');
const path = require('path');
const fs = require('fs');

app.setName('Panel Peek');

// ---------- settings ----------
// One-time move of history, sites and logins from the old "manga-bubble" folder.
(function migrateFromOldName() {
  const oldDir = path.join(app.getPath('appData'), 'manga-bubble');
  const newDir = app.getPath('userData');
  try {
    if (!fs.existsSync(path.join(oldDir, 'settings.json')) || fs.existsSync(path.join(newDir, 'settings.json'))) return;
    fs.mkdirSync(newDir, { recursive: true });
    fs.copyFileSync(path.join(oldDir, 'settings.json'), path.join(newDir, 'settings.json'));
    const oldParts = path.join(oldDir, 'Partitions');
    if (fs.existsSync(oldParts)) fs.cpSync(oldParts, path.join(newDir, 'Partitions'), { recursive: true });
  } catch (err) {
    console.warn('settings migration failed:', err.message);
  }
})();

const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = {
  expanded: { width: 420, height: 640 },
  bubble: { x: null, y: null },     // top-left of the bubble on screen
  opacity: 0.85,                    // reader opacity
  bubbleOpacity: 0.6,
  lastUrl: 'https://www.google.com',
  lastFolder: null,
  zoom: 1,
  hideDelay: 0,                     // ms after mouse leaves before shrinking (0 = instant)
  expandDelay: 350,                 // ms of hovering the bubble before expanding
  adblock: true,
  history: [],                      // reading history, newest first (managed by the renderer)
  // Site shortcuts on the Home screen. Editable in the app; these sites change domains often.
  sites: [
    { name: 'Asura Scans', url: 'https://asuracomic.net' },
    { name: 'Comix', url: 'https://comix.to' },
    { name: 'MangaDex', url: 'https://mangadex.org' },
    { name: 'Webtoon', url: 'https://www.webtoons.com/en/' },
    { name: 'MANGA Plus', url: 'https://mangaplus.shueisha.co.jp' },
    { name: 'Tapas', url: 'https://tapas.io' }
  ]
};

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}
let settings = loadSettings();
let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch {}
  }, 300);
}

// ---------- window ----------
const BUBBLE = 56;
let win;
let collapsed = true;      // start as a bubble
let hidden = false;
let pinned = false;           // pinned = never auto-collapse
let leaveTimer = null;
let hoverTimer = null;
let programmaticMove = false;

function workAreaFor(point) {
  return screen.getDisplayNearestPoint(point).workArea;
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function bubbleBounds() {
  let { x, y } = settings.bubble;
  if (x == null || y == null) {
    const wa = screen.getPrimaryDisplay().workArea;
    x = wa.x + wa.width - BUBBLE - 24;
    y = wa.y + Math.round(wa.height / 3);
  }
  const wa = workAreaFor({ x, y });
  x = clamp(x, wa.x, wa.x + wa.width - BUBBLE);
  y = clamp(y, wa.y, wa.y + wa.height - BUBBLE);
  return { x, y, width: BUBBLE, height: BUBBLE };
}

// Expanded panel opens with its top-right corner on the bubble's top-right,
// flipping/clamping so it always fits on the screen.
function expandedBounds() {
  const b = bubbleBounds();
  const { width, height } = settings.expanded;
  const wa = workAreaFor({ x: b.x, y: b.y });
  let x = b.x + BUBBLE - width;
  if (x < wa.x) x = b.x;                       // not enough room on the left -> open to the right
  let y = b.y;
  x = clamp(x, wa.x, wa.x + wa.width - width);
  y = clamp(y, wa.y, wa.y + wa.height - height);
  return { x, y, width, height };
}

function setBoundsSafe(bounds) {
  programmaticMove = true;
  win.setBounds(bounds);
  setTimeout(() => { programmaticMove = false; }, 120);
}

function collapse() {
  if (collapsed || !win) return;
  collapsed = true;
  // Vanish instantly at the OS level, shrink to the bubble, then show the bubble.
  win.setOpacity(0);
  win.webContents.send('state', { collapsed: true });
  setBoundsSafe(bubbleBounds());
  setTimeout(() => { if (collapsed && win && !win.isDestroyed()) win.setOpacity(1); }, 80);
}

function expand() {
  if (!collapsed || !win) return;
  collapsed = false;
  win.setOpacity(1);
  setBoundsSafe(expandedBounds());
  win.webContents.send('state', { collapsed: false });
}

function createWindow() {
  win = new BrowserWindow({
    ...bubbleBounds(),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,     // resizing is done with our own grip (transparent windows can't use the OS frame)
    hasShadow: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });
  win.setAlwaysOnTop(true, 'floating');
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // While collapsed, dragging the bubble moves the window -> remember position.
  win.on('move', () => {
    if (programmaticMove) return;
    if (collapsed) {
      const [x, y] = win.getPosition();
      settings.bubble = { x, y };
      saveSettings();
      // don't expand while the user is dragging the bubble around
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
  });

  win.webContents.on('did-finish-load', () => {
    win.webContents.send('init', settings);
    win.webContents.send('state', { collapsed });
  });

  startHoverWatcher();
}

// Poll the cursor instead of relying on DOM mouseleave: the embedded <webview>
// swallows mouse events, and the OS cursor position is always reliable.
function startHoverWatcher() {
  setInterval(() => {
    if (!win || win.isDestroyed() || hidden) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    if (moveStart || resizeStart) return;   // never hide mid-drag
    const pad = 0;
    const inside = p.x >= b.x - pad && p.x <= b.x + b.width + pad &&
                   p.y >= b.y - pad && p.y <= b.y + b.height + pad;

    if (collapsed) {
      if (inside) {
        if (!hoverTimer) hoverTimer = setTimeout(() => { hoverTimer = null; expand(); }, settings.expandDelay);
      } else if (hoverTimer) {
        clearTimeout(hoverTimer); hoverTimer = null;
      }
    } else {
      if (inside || pinned) {
        if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
      } else if (!(settings.hideDelay > 0)) {
        collapse();
      } else if (!leaveTimer) {
        leaveTimer = setTimeout(() => { leaveTimer = null; collapse(); }, settings.hideDelay);
      }
    }
  }, 30);
}

// ---------- IPC ----------
ipcMain.on('save-settings', (_e, patch) => { Object.assign(settings, patch); saveSettings(); });
ipcMain.on('collapse-now', () => collapse());
ipcMain.on('set-pinned', (_e, v) => { pinned = !!v; });
ipcMain.on('quit', () => app.quit());

// custom resize grip (bottom-left or bottom-right)
let resizeStart = null;
ipcMain.on('resize-start', (_e, side) => {
  resizeStart = { side, cursor: screen.getCursorScreenPoint(), bounds: win.getBounds() };
});
ipcMain.on('resize-move', () => {
  if (!resizeStart || collapsed) return;
  const p = screen.getCursorScreenPoint();
  const dx = p.x - resizeStart.cursor.x;
  const dy = p.y - resizeStart.cursor.y;
  const s = resizeStart.bounds;
  const height = Math.max(260, s.height + dy);
  let width, x;
  if (resizeStart.side === 'left') {
    width = Math.max(260, s.width - dx);
    x = s.x + s.width - width;
  } else {
    width = Math.max(260, s.width + dx);
    x = s.x;
  }
  setBoundsSafe({ x, y: s.y, width, height });
});
ipcMain.on('resize-end', () => {
  if (!resizeStart) return;
  const b = win.getBounds();
  settings.expanded = { width: b.width, height: b.height };
  // keep the bubble anchored to the panel's top-right corner
  settings.bubble = { x: b.x + b.width - BUBBLE, y: b.y };
  saveSettings();
  resizeStart = null;
});

// moving the expanded panel by its title bar
let moveStart = null;
ipcMain.on('move-start', () => {
  moveStart = { cursor: screen.getCursorScreenPoint(), bounds: win.getBounds() };
});
ipcMain.on('move-move', () => {
  if (!moveStart || collapsed) return;
  const p = screen.getCursorScreenPoint();
  const s = moveStart.bounds;
  setBoundsSafe({ x: s.x + p.x - moveStart.cursor.x, y: s.y + p.y - moveStart.cursor.y, width: s.width, height: s.height });
});
ipcMain.on('move-end', () => {
  if (!moveStart) return;
  const b = win.getBounds();
  settings.bubble = { x: b.x + b.width - BUBBLE, y: b.y };
  saveSettings();
  moveStart = null;
});

const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp']);
function listImages(folder) {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return fs.readdirSync(folder)
    .filter(f => IMG_EXT.has(path.extname(f).toLowerCase()))
    .sort(collator.compare)
    .map(f => path.join(folder, f));
}
function listChapters(folder) {
  // sibling folders = chapters, for "next chapter"
  const parent = path.dirname(folder);
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  try {
    return fs.readdirSync(parent, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => path.join(parent, d.name)).sort(collator.compare);
  } catch { return []; }
}

ipcMain.handle('open-folder', async () => {
  const wasPinned = pinned;
  pinned = true; // don't collapse while the dialog is open
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: settings.lastFolder || undefined });
  pinned = wasPinned;
  if (r.canceled || !r.filePaths[0]) return null;
  return loadFolder(r.filePaths[0]);
});
ipcMain.handle('load-folder', (_e, folder) => {
  try { return loadFolder(folder); } catch { return null; }
});
function loadFolder(folder) {
  settings.lastFolder = folder; saveSettings();
  const chapters = listChapters(folder);
  const i = chapters.indexOf(folder);
  return {
    folder,
    name: path.basename(folder),
    images: listImages(folder),
    prev: i > 0 ? chapters[i - 1] : null,
    next: i >= 0 && i < chapters.length - 1 ? chapters[i + 1] : null
  };
}

// ---------- app ----------
// Popups on scan sites are almost always ads: never open new windows from the reader.
app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  }
});

function setupSession() {
  const ses = session.fromPartition('persist:manga');
  // Look like a normal Chrome browser (some sites refuse "Electron" user agents).
  ses.setUserAgent(ses.getUserAgent().replace(/\s?Electron\/\S+/, '').replace(/\s?(manga-bubble|panel-peek|Panel Peek)\/\S+/gi, ''));
  if (settings.adblock) {
    try {
      const { ElectronBlocker } = require('@ghostery/adblocker-electron');
      ElectronBlocker.fromPrebuiltAdsAndTracking(fetch)
        .then((blocker) => blocker.enableBlockingInSession(ses))
        .catch((err) => console.warn('adblock failed to load:', err.message));
    } catch (err) {
      console.warn('adblock unavailable:', err.message);
    }
  }
}

app.whenReady().then(() => {
  setupSession();
  createWindow();

  // Boss key: instantly hide / show everything
  globalShortcut.register('Control+Alt+H', () => {
    if (!win) return;
    if (hidden) { hidden = false; win.showInactive(); }
    else { hidden = true; collapse(); win.hide(); }
  });
  // Quick collapse
  globalShortcut.register('Control+Alt+M', () => { if (collapsed) expand(); else collapse(); });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
