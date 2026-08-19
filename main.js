const { app, BrowserWindow, ipcMain, dialog, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// Local audio files are served through this custom scheme instead of raw
// file:// URLs. Sandboxed renderers can silently fail to load file:// media
// (UI shows "playing" but no audio ever decodes, duration stays 0) — this
// must be registered before app is ready, or registration is a no-op.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  }
]);

// Cross-platform, per-user Documents folder — works for anyone who runs
// this app, on any OS, without hardcoding a personal username/path.
const TARGET_DIR = app.getPath('documents');
const STATE_FILE_PATH = path.join(TARGET_DIR, 'academic-dashboard-state.json');

let dashboardWindow = null;
let typewriterWindow = null;
let appState = null;

// id (base64url of the absolute file path) -> absolute file path.
// Rebuilt on every app-media request lookup miss by rescanning the saved
// localPath, so it survives app restarts even though the Map itself is
// only ever populated in memory.
const mediaFileMap = new Map();

function scanLocalDirectory(dirPath) {
  const files = fs.readdirSync(dirPath);
  const audioExtensions = ['.mp3', '.wav', '.ogg'];
  return files
    .filter(f => audioExtensions.includes(path.extname(f).toLowerCase()))
    .map(f => {
      const fullPath = path.join(dirPath, f);
      const id = Buffer.from(fullPath, 'utf-8').toString('base64url');
      mediaFileMap.set(id, fullPath);
      return { name: f, path: fullPath, url: `app-media://local/${id}` };
    });
}

// India Standard Time (IST) Date Utility
function getKolkataDateInfo() {
  const now = new Date();
  const formatterDate = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
  });
  const parts = formatterDate.formatToParts(now);
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;

  const formatterDay = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata", weekday: "short"
  });
  const rawDay = formatterDay.format(now);
  const dayMap = { "Mon": "Mon", "Tue": "Tues", "Wed": "Wed", "Thu": "Thurs", "Fri": "Fri", "Sat": "Sat", "Sun": "Sun" };

  return {
    dateStr: `${y}-${m}-${d}`,
    dayKey: dayMap[rawDay] || rawDay
  };
}

// FIXED: Default initial state uses SomaFM Groove Salad as default internet stream
function getInitialState() {
  const info = getKolkataDateInfo();
  return {
    meta: {
      title: "Academic Life Dashboard",
      timezone: "Asia/Kolkata",
      todayDate: info.dateStr,
      todayDayKey: info.dayKey
    },
    lofiPlayer: {
      mode: "stream",
      streamUrl: "https://ice.somafm.com/groovesalad",
      streamName: "SomaFM — Groove Salad",
      autoplay: false,
      localPath: "",
      localFiles: [],
      currentIndex: 0,
      volume: 0.5,
      shuffle: false
    },
    weekAtAGlance: {
      Mon: [{ id: "mon1", text: "Read research paper syllabus", done: false }],
      Tues: [{ id: "tues1", text: "Lab meeting & data analysis", done: false }],
      Wed: [{ id: "wed1", text: "Office hours", done: false }],
      Thurs: [{ id: "thurs1", text: "Review math problem set", done: false }],
      Fri: [{ id: "fri1", text: "Code audit and commits", done: false }],
      Sat: [{ id: "sat1", text: "Synthesize weekly logs", done: false }],
      Sun: [{ id: "sun1", text: "Plan recurring goals", done: false }]
    },
    todayTopPriorities: {
      date: info.dateStr,
      dayKey: info.dayKey,
      items: [
        { id: "tp1", text: "Lab meeting & data analysis", done: false, fromWeekTaskId: null, pinned: false, hidden: false, order: 1 }
      ],
      isCustomized: false
    },
    typewriterPlan: {
      active: false,
      title: "Custom Plan",
      sections: [],
      history: []
    },
    deadlines: [
      { id: "d1", title: "CS702 Midterm Project", dueDate: info.dateStr, category: "Coursework", status: "Upcoming", notes: "Include repo links" }
    ],
    habitTracker: {
      habits: [
        { id: "h1", name: "Deep Study (2 Hours)", active: true },
        { id: "h2", name: "Workout / Mobility", active: true },
        { id: "h3", name: "Read Non-Fiction (20 Pages)", active: true }
      ],
      checkins: []
    },
    bookTracker: { books: [] },
    internshipGigTracker: { items: [] },
    typewriterEnabled: true,
    muted: false,
    typewriterViewMode: "focus"
  };
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      const raw = fs.readFileSync(STATE_FILE_PATH, 'utf-8');
      appState = JSON.parse(raw);
      refreshLocalMediaUrls();
      return;
    }
  } catch (e) {
    console.error("Failed to load state. Resetting:", e);
  }
  appState = getInitialState();
  saveState(appState);
}

// Rebuilds mediaFileMap and rewrites localFiles[].url to app-media://
// URLs, both for old saves that still have raw file:// URLs from before
// this fix, and for fresh app starts where the in-memory map is empty.
function refreshLocalMediaUrls() {
  const dirPath = appState?.lofiPlayer?.localPath;
  if (!dirPath) return;
  try {
    if (!fs.existsSync(dirPath)) return;
    const audioFiles = scanLocalDirectory(dirPath);
    appState.lofiPlayer.localFiles = audioFiles;
    if (appState.lofiPlayer.currentIndex >= audioFiles.length) {
      appState.lofiPlayer.currentIndex = 0;
    }
  } catch (e) {
    console.error("Failed to refresh local media directory:", e);
  }
}

function saveState(newState) {
  if (!newState || typeof newState !== 'object') {
    console.error("saveState: Dropped attempt to write invalid state:", newState);
    return;
  }

  try {
    const rawString = JSON.stringify(newState, null, 2);
    if (!rawString || rawString === '{}' || rawString === 'null') {
      console.error("saveState: Dropped empty serialization package:", rawString);
      return;
    }

    appState = newState;
    fs.mkdirSync(path.dirname(STATE_FILE_PATH), { recursive: true });
    fs.writeFileSync(STATE_FILE_PATH, rawString, 'utf-8');
    broadcastState();
  } catch (e) {
    console.error("saveState: Write failed:", e);
  }
}

function broadcastState() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.webContents.send('state-updated', appState);
  }
  if (typewriterWindow && !typewriterWindow.isDestroyed()) {
    typewriterWindow.webContents.send('state-updated', appState);
  }
}

function createDashboardWindow() {
  dashboardWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    useContentSize: true,
    title: "Academic Life Dashboard",
    backgroundColor: '#0B0B0B',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  dashboardWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  dashboardWindow.on('closed', () => {
    dashboardWindow = null;
    if (typewriterWindow) typewriterWindow.close();
  });
}

function createTypewriterWindow() {
  if (typewriterWindow) return;

  typewriterWindow = new BrowserWindow({
    width: 420,
    height: 720,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  typewriterWindow.loadFile(path.join(__dirname, 'src', 'typewriter.html'));

  typewriterWindow.on('closed', () => {
    typewriterWindow = null;
    if (appState && appState.typewriterEnabled) {
      appState.typewriterEnabled = false;
      saveState(appState);
    }
  });
}

app.whenReady().then(() => {
  // Serve local audio through app-media:// so sandboxed <audio> tags get
  // real streamed bytes via net.fetch instead of a raw file:// load.
  protocol.handle('app-media', async (request) => {
    try {
      const id = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ''));
      let filePath = mediaFileMap.get(id);
      if (!filePath) {
        // Map is empty right after a fresh app start — rescan the saved
        // directory once and retry before giving up.
        if (appState && appState.lofiPlayer && appState.lofiPlayer.localPath) {
          try { scanLocalDirectory(appState.lofiPlayer.localPath); } catch (_) {}
          filePath = mediaFileMap.get(id);
        }
      }
      if (!filePath || !fs.existsSync(filePath)) {
        return new Response('Not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (e) {
      console.error('app-media protocol error:', e);
      return new Response('Error', { status: 500 });
    }
  });

  loadState();
  createDashboardWindow();

  if (appState && appState.typewriterEnabled) {
    createTypewriterWindow();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

ipcMain.handle('get-state', async () => {
  if (!appState) loadState();
  return appState;
});

ipcMain.handle('save-state', async (_, state) => {
  saveState(state);
  return appState;
});

ipcMain.handle('toggle-typewriter', async (_, enable) => {
  if (enable) createTypewriterWindow();
  else if (typewriterWindow) typewriterWindow.close();
});

ipcMain.handle('set-typewriter-height', async (_, height) => {
  if (typewriterWindow && !typewriterWindow.isDestroyed()) {
    const [w] = typewriterWindow.getSize();
    typewriterWindow.setSize(w, height, true);
  }
});

ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    win.setIgnoreMouseEvents(ignore, options);
  }
});

// FIXED: Expose plain native local file URL converter
ipcMain.handle('path-to-file-url', async (_, filePath) => {
  return pathToFileURL(filePath).toString();
});

ipcMain.handle('select-local-directory', async () => {
  if (!dashboardWindow) return null;
  const result = await dialog.showOpenDialog(dashboardWindow, {
    properties: ['openDirectory']
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  const dirPath = result.filePaths[0];

  try {
    const audioFiles = scanLocalDirectory(dirPath);
    return { path: dirPath, files: audioFiles };
  } catch (err) {
    console.error("Failed to read directory:", err);
    return null;
  }
});