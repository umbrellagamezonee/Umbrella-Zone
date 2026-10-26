// CueBill for Windows - fully offline. Opens the app from the files installed with
// it, and keeps all data as files in C:\CueBill-Data on this PC. It never
// connects to any server (every http/https request is refused below).
const { app, BrowserWindow, Menu, protocol, session, shell, ipcMain, dialog } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DataStore, dayStamp } = require("./storage");

app.setName("CueBill");
// test hooks (never set on a real PC)
if (process.env.CUEBILL_USER_DATA) app.setPath("userData", process.env.CUEBILL_USER_DATA);
if (process.env.CUEBILL_DEBUG_PORT) app.commandLine.appendSwitch("remote-debugging-port", process.env.CUEBILL_DEBUG_PORT);

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const WEB_ROOT = path.join(__dirname, "app-dist");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

let store = null;
let mainWindow = null;
let logFile = null;

function log(msg) {
  console.log(msg);
  if (!logFile) return;
  try {
    fs.appendFileSync(logFile, `${new Date().toISOString()}  ${msg}\n`);
  } catch {
    /* logging must never break the app */
  }
}

function resourceDir(name) {
  return app.isPackaged ? path.join(process.resourcesPath, name) : path.join(__dirname, "pack-data", name);
}

// The data lives in its own folder on the PC's main drive (C:\CueBill-Data). Not in
// Documents: on many PCs that folder is silently copied to OneDrive, which would put
// the shop's data on the internet and fight with the app over the files.
function openStore() {
  const candidates = process.env.CUEBILL_DATA_DIR
    ? [process.env.CUEBILL_DATA_DIR]
    : [path.join(process.env.SystemDrive ? process.env.SystemDrive + path.sep : "C:\\", "CueBill-Data"), path.join(process.env.LOCALAPPDATA || app.getPath("userData"), "CueBill-Data")];
  let lastError = null;
  for (const root of candidates) {
    try {
      fs.mkdirSync(root, { recursive: true });
      logFile = path.join(root, "cuebill-log.txt");
      try {
        if (fs.statSync(logFile).size > 512 * 1024) fs.renameSync(logFile, logFile + ".old");
      } catch {
        /* no log yet */
      }
      const s = new DataStore(root, log);
      log(`CueBill ${app.getVersion()} shuru - data folder: ${root}`);
      return s;
    } catch (e) {
      lastError = e;
    }
  }
  dialog.showErrorBox("CueBill", `Data folder nahi ban paya.\n\n${lastError && lastError.message}`);
  app.exit(1);
  return null;
}

// First start on a PC: bring in the old data that was packed into the installer, and
// put the old-data PDF next to the data so it is on this PC too.
function firstRunSetup() {
  if (store.isEmpty()) {
    const file = path.join(resourceDir("initial-data"), "cuebill-data-backup.json");
    if (fs.existsSync(file)) {
      try {
        const n = store.importBackup(JSON.parse(fs.readFileSync(file, "utf8")));
        log(`Purana data le liya (${n} items) - ${file}`);
      } catch (e) {
        log(`Purana data nahi le paya: ${e.message}`);
      }
    }
  }
  const pdfSrc = resourceDir("old-data");
  if (fs.existsSync(pdfSrc)) {
    const dest = path.join(store.root, "Purana-Data-PDF");
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(pdfSrc)) {
      const to = path.join(dest, f);
      if (!fs.existsSync(to)) fs.copyFileSync(path.join(pdfSrc, f), to);
    }
  }
}

function isOurPage(event) {
  const url = (event.senderFrame && event.senderFrame.url) || event.sender.getURL();
  return typeof url === "string" && url.startsWith("app://");
}

function registerIpc() {
  ipcMain.on("storage:load", (event) => {
    event.returnValue = isOurPage(event) ? store.snapshot() : {};
  });
  ipcMain.on("storage:save", (event, batch) => {
    if (isOurPage(event) && batch && typeof batch === "object") store.apply(batch);
  });
  ipcMain.on("storage:save-sync", (event, batch) => {
    if (isOurPage(event) && batch && typeof batch === "object") {
      store.apply(batch);
      store.flushNow();
    }
    event.returnValue = true;
  });
  ipcMain.on("backup-now", (event) => {
    let file = "";
    if (isOurPage(event)) {
      try {
        store.flushNow();
        const t = new Date();
        const stamp = `${dayStamp(t)}-${String(t.getHours()).padStart(2, "0")}${String(t.getMinutes()).padStart(2, "0")}${String(t.getSeconds()).padStart(2, "0")}`;
        file = store.writeBackup(path.join(store.backupDir, `cuebill-backup-before-merge-${stamp}.json`));
        log(`Jodne se pehle backup: ${file}`);
      } catch (e) {
        log(`Jodne se pehle backup nahi ban paya: ${e.message}`);
      }
    }
    event.returnValue = file;
  });
  ipcMain.on("print-pdf", (event) => {
    if (isOurPage(event)) savePdf(BrowserWindow.fromWebContents(event.sender)).catch((e) => log(`PDF nahi bani: ${e.message}`));
  });
}

// The app's "PDF / Print" button: save what is on screen as a PDF file.
async function savePdf(win) {
  if (!win) return;
  let filePath;
  if (process.env.CUEBILL_AUTO_DOWNLOAD_DIR) {
    filePath = path.join(process.env.CUEBILL_AUTO_DOWNLOAD_DIR, `CueBill-${dayStamp()}.pdf`);
  } else {
    const r = await dialog.showSaveDialog(win, {
      title: "PDF kahan save karni hai?",
      defaultPath: path.join(app.getPath("downloads"), `CueBill-Hisaab-${dayStamp()}.pdf`),
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (r.canceled || !r.filePath) return;
    filePath = r.filePath;
  }
  const data = await win.webContents.printToPDF({ printBackground: false, preferCSSPageSize: true, pageSize: "A4" });
  fs.writeFileSync(filePath, data);
  log(`PDF save hui: ${filePath}`);
  if (!process.env.CUEBILL_AUTO_DOWNLOAD_DIR) shell.showItemInFolder(filePath);
}

async function saveBackupAs(win) {
  const r = await dialog.showSaveDialog(win, {
    title: "Backup kahan save karna hai? (pendrive chuno)",
    defaultPath: path.join(app.getPath("documents"), `CueBill-Backup-${os.hostname()}-${dayStamp()}.json`),
    filters: [{ name: "CueBill backup", extensions: ["json"] }],
  });
  if (r.canceled || !r.filePath) return;
  store.flushNow();
  store.writeBackup(r.filePath);
  log(`Backup save hua: ${r.filePath}`);
  dialog.showMessageBox(win, { type: "info", title: "CueBill", message: "Backup ho gaya", detail: r.filePath });
}

function buildMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        { label: "Backup pendrive par save karo...", click: () => saveBackupAs(mainWindow) },
        { label: "Data folder kholo", click: () => shell.openPath(store.root) },
        { type: "separator" },
        { label: "Band karo", role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload", label: "Dobara kholo" },
        { role: "togglefullscreen", label: "Full screen" },
        { type: "separator" },
        { role: "zoomIn", label: "Bada karo" },
        { role: "zoomOut", label: "Chhota karo" },
        { role: "resetZoom", label: "Normal size" },
        { type: "separator" },
        { role: "toggleDevTools", label: "Developer tools" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "CueBill ke baare mein",
          click: () =>
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "CueBill",
              message: `CueBill ${app.getVersion()} (offline)`,
              detail: `Saara data is PC par yahan hai:\n${store.root}\n\nKoi server ya internet nahi chahiye.`,
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerAppProtocol() {
  protocol.handle("app", async (request) => {
    try {
      const rel = decodeURIComponent(new URL(request.url).pathname);
      let file = path.normalize(path.join(WEB_ROOT, rel));
      if (!file.startsWith(WEB_ROOT)) return new Response("Not allowed", { status: 403 });
      let isFile = false;
      try {
        isFile = fs.statSync(file).isFile();
      } catch {
        /* not there */
      }
      // any other address is one of the app's own screens (/credits, /reports ...)
      if (!isFile) file = path.join(WEB_ROOT, "index.html");
      const body = await fs.promises.readFile(file);
      return new Response(body, {
        headers: { "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-cache" },
      });
    } catch (e) {
      log(`app:// error: ${e.message}`);
      return new Response("Error", { status: 500 });
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 360,
    minHeight: 560,
    show: false,
    title: "CueBill",
    icon: path.join(__dirname, "icon.png"),
    autoHideMenuBar: true,
    backgroundColor: "#0a0612",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow.maximize();
    mainWindow.show();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("app://")) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
  let crashes = [];
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    const now = Date.now();
    crashes = crashes.filter((t) => now - t < 60000).concat(now);
    log(`Page crash hua (${details.reason})`);
    if (crashes.length > 3) {
      dialog.showErrorBox("CueBill", "CueBill baar baar band ho raha hai. Data safe hai (C:\\CueBill-Data). Support ko batao.");
      return;
    }
    mainWindow.reload();
  });
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => log(`Page load fail: ${code} ${desc} ${url}`));
  mainWindow.loadURL("app://cuebill/");
  mainWindow.on("closed", () => (mainWindow = null));
}

if (!app.requestSingleInstanceLock()) {
  // CueBill is already open - two copies writing the same data would corrupt it
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    store = openStore();
    if (!store) return;
    firstRunSetup();
    store.dailyBackup();

    // Offline for real: nothing in the app may reach the internet.
    session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*", "ftp://*/*"] }, (_d, cb) => cb({ cancel: true }));
    session.defaultSession.on("will-download", (_e, item) => {
      if (process.env.CUEBILL_AUTO_DOWNLOAD_DIR) item.setSavePath(path.join(process.env.CUEBILL_AUTO_DOWNLOAD_DIR, item.getFilename()));
    });

    registerAppProtocol();
    registerIpc();
    buildMenu();
    createWindow();
  });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    if (!store) return;
    try {
      store.flushNow();
      store.closeBackup();
      log("CueBill band hua");
    } catch (e) {
      log(`Band hote waqt dikkat: ${e.message}`);
    }
  });
}
