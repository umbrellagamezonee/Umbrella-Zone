// Where CueBill keeps everything on the PC. Plain Node (no Electron), so it can be
// tested on its own: node test-storage.js
//
//   <root>/Data/<key>.json        one file per saved item (bills, customers, ...)
//   <root>/Data/<key>.json.prev   the version before the last save (safety net)
//   <root>/Backups/               a full backup file per day, and one from the last time the app closed
//
// Every save is written to a temporary file first and only then swapped in, so a
// power cut in the middle of a save can never leave a half-written file behind.
const fs = require("fs");
const path = require("path");

const BACKUP_PREFIX = "cuebill-backup-";
const KEEP_DAILY_BACKUPS = 21;

const fileFor = (key) => encodeURIComponent(key).replace(/\./g, "%2E") + ".json";
const keyFor = (file) => decodeURIComponent(file.replace(/\.json(\.prev)?$/, ""));

function pad(n) {
  return String(n).padStart(2, "0");
}
function dayStamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Write a file so that it is either fully there or not changed at all.
function atomicWrite(file, text) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

class DataStore {
  constructor(root, log = () => {}) {
    this.root = root;
    this.dataDir = path.join(root, "Data");
    this.backupDir = path.join(root, "Backups");
    this.log = log;
    this.map = new Map();
    this.dirty = new Set();
    this.timer = null;
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(this.backupDir, { recursive: true });
    this.loadAll();
  }

  // ---- reading ----
  readEnvelope(file) {
    try {
      const o = JSON.parse(fs.readFileSync(file, "utf8"));
      if (o && typeof o.k === "string" && typeof o.v === "string") return o;
    } catch {
      /* missing or damaged */
    }
    return null;
  }

  loadAll() {
    const keys = new Set();
    for (const f of fs.readdirSync(this.dataDir)) {
      if (/\.json(\.prev)?$/.test(f)) keys.add(keyFor(f));
    }
    let backup = null; // loaded lazily, only if something is damaged
    for (const key of keys) {
      const base = path.join(this.dataDir, fileFor(key));
      let env = this.readEnvelope(base);
      if (env && env.k === key) {
        this.map.set(key, env.v);
        continue;
      }
      env = this.readEnvelope(base + ".prev");
      if (env && env.k === key) {
        this.log(`"${key}" ki file kharab thi - pichhla save wapas liya`);
        this.map.set(key, env.v);
        this.dirty.add(key);
        continue;
      }
      if (backup === null) backup = this.latestBackupContents() ?? {};
      if (typeof backup[key] === "string") {
        this.log(`"${key}" ki file kharab thi - backup se wapas liya`);
        this.map.set(key, backup[key]);
        this.dirty.add(key);
      } else {
        this.log(`"${key}" ki file kharab thi aur backup mein nahi mili`);
      }
    }
    if (this.dirty.size) this.flushNow();
  }

  isEmpty() {
    return this.map.size === 0;
  }

  snapshot() {
    return Object.fromEntries(this.map);
  }

  // ---- writing ----
  // batch: { key: "value" | null }  (null removes the key)
  apply(batch) {
    for (const [key, value] of Object.entries(batch)) {
      if (typeof key !== "string") continue;
      if (value === null) this.map.delete(key);
      else if (typeof value === "string") this.map.set(key, value);
      else continue;
      this.dirty.add(key);
    }
    this.writeSoon();
  }

  writeSoon() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushNow();
    }, 150);
  }

  flushNow() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const key of [...this.dirty]) {
      try {
        this.writeKey(key);
        this.dirty.delete(key);
      } catch (e) {
        this.log(`"${key}" save nahi ho paya: ${e.message}`); // stays dirty, retried on the next flush
      }
    }
    return this.dirty.size === 0;
  }

  writeKey(key) {
    const file = path.join(this.dataDir, fileFor(key));
    if (!this.map.has(key)) {
      for (const f of [file, file + ".prev"]) fs.rmSync(f, { force: true });
      return;
    }
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ k: key, v: this.map.get(key), t: Date.now() }));
    if (fs.existsSync(file)) fs.renameSync(file, file + ".prev");
    fs.renameSync(tmp, file);
  }

  // ---- backups ----
  // The same format as the app's own Settings -> Backup & Restore file.
  backupObject() {
    const out = {};
    for (const [k, v] of this.map) if (k.startsWith("cuebill")) out[k] = v;
    return out;
  }

  hasRealData() {
    return this.map.has("cuebill-bills") || this.map.has("cuebill-customers");
  }

  writeBackup(file) {
    atomicWrite(file, JSON.stringify(this.backupObject()));
    return file;
  }

  // One backup per day (the first start of the day) and one from the last close.
  dailyBackup() {
    if (!this.hasRealData()) return null;
    const file = path.join(this.backupDir, `${BACKUP_PREFIX}${dayStamp()}.json`);
    if (!fs.existsSync(file)) this.writeBackup(file);
    this.pruneBackups();
    return file;
  }

  closeBackup() {
    if (!this.hasRealData()) return null;
    return this.writeBackup(path.join(this.backupDir, "cuebill-backup-last-close.json"));
  }

  pruneBackups() {
    const dated = fs
      .readdirSync(this.backupDir)
      .filter((f) => /^cuebill-backup-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    for (const f of dated.slice(0, Math.max(0, dated.length - KEEP_DAILY_BACKUPS))) {
      fs.rmSync(path.join(this.backupDir, f), { force: true });
    }
  }

  latestBackupContents() {
    let files = [];
    try {
      files = fs.readdirSync(this.backupDir).filter((f) => /^cuebill-backup-.*\.json$/.test(f));
    } catch {
      return null;
    }
    // newest dated one first, then the "last close" one
    files.sort().reverse();
    for (const f of files) {
      try {
        const o = JSON.parse(fs.readFileSync(path.join(this.backupDir, f), "utf8"));
        if (o && typeof o === "object") return o;
      } catch {
        /* try the next one */
      }
    }
    return null;
  }

  // Load a backup file (Settings -> Backup & Restore format). Returns how many items were read.
  importBackup(obj) {
    let n = 0;
    const batch = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith("cuebill") && typeof v === "string") {
        batch[k] = v;
        n++;
      }
    }
    this.apply(batch);
    this.flushNow();
    return n;
  }
}

module.exports = { DataStore, dayStamp, fileFor, keyFor };
