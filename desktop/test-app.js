// End-to-end check of the offline desktop app, on an isolated data folder (never the real one):
//   node test-app.js [--exe path\to\CueBill.exe] [--dir work-folder]
// It starts the app, drives it through its debug port, and checks: old data is loaded,
// nothing reaches the network, writes survive closing AND a hard kill, Excel and PDF
// downloads work, and a damaged data file is repaired. Needs the web build and
// pack-data (npm run pack does both) - or pass the installed CueBill.exe.
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const WORK = arg("--dir") || path.join(os.tmpdir(), "cuebill-e2e");
const EXE = arg("--exe");
const PORT = 9333;
const DATA = path.join(WORK, "data");
const USER = path.join(WORK, "user");
const DL = path.join(WORK, "downloads");
const SHOTS = path.join(WORK, "shots");
fs.rmSync(WORK, { recursive: true, force: true });
for (const d of [DATA, USER, DL, SHOTS]) fs.mkdirSync(d, { recursive: true });

let failed = 0;
const check = (name, ok, extra = "") => {
  if (!ok) failed++;
  console.log(ok ? "OK  " : "FAIL", name, ok ? "" : extra);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const step = (n) => console.log(`   [${Math.round((Date.now() - T0) / 1000)}s] ${n}`);

// ---------- launching ----------
let proc = null;
function launch() {
  const env = { ...process.env, CUEBILL_DATA_DIR: DATA, CUEBILL_USER_DATA: USER, CUEBILL_DEBUG_PORT: String(PORT), CUEBILL_AUTO_DOWNLOAD_DIR: DL };
  const cmd = EXE || path.join(__dirname, "node_modules", "electron", "dist", "electron.exe");
  proc = spawn(cmd, EXE ? [] : ["."], { cwd: __dirname, env, stdio: "ignore" });
  return proc;
}
function hardKill() {
  if (proc && proc.pid) spawnSync("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { stdio: "ignore" });
  proc = null;
}
async function waitExit(ms = 15000) {
  const p = proc;
  if (!p) return true;
  const t0 = Date.now();
  while (p.exitCode === null && Date.now() - t0 < ms) await sleep(100);
  return p.exitCode !== null;
}

// ---------- tiny DevTools-protocol client ----------
class Cdp {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
  }
  async open() {
    this.ws = new WebSocket(this.url);
    await new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = rej;
    });
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      } else if (m.method) this.handlers.forEach((h) => h(m));
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  onEvent(fn) {
    this.handlers.push(fn);
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  close() {
    try {
      this.ws.close();
    } catch {
      /* already gone */
    }
  }
}

async function connect() {
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && t.url.startsWith("app://"));
      if (page) {
        const c = new Cdp(page.webSocketDebuggerUrl);
        await c.open();
        c.errors = [];
        c.requests = [];
        c.onEvent((m) => {
          if (m.method === "Runtime.exceptionThrown") c.errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
          if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") c.errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
          if (m.method === "Inspector.targetCrashed") console.log("   !! page crashed");
          if (m.method === "Network.requestWillBeSent") c.requests.push(m.params.request.url);
        });
        await c.send("Runtime.enable");
        await c.send("Network.enable");
        return c;
      }
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error("App did not start");
}

// ---------- driving the screen ----------
async function textNow(c) {
  return c.eval("document.body.innerText");
}
async function waitFor(c, test, label, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if (await c.eval(test)) return true;
    } catch {
      /* page reloading */
    }
    await sleep(250);
  }
  check("waited for: " + label, false, "timed out");
  return false;
}
async function clickAt(c, x, y) {
  await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}
// click the smallest visible element whose text is exactly / contains `text`
async function clickText(c, text, { exact = true, tag = "button, a, [role=button], div, span, p, h3, label" } = {}) {
  const pos = await c.eval(`(() => {
    const want = ${JSON.stringify(text)}, exact = ${exact};
    const ok = (el) => { const t = el.textContent.trim().replace(/\\s+/g, " "); return exact ? t === want : t.includes(want); };
    let best = null, bestLen = 1e9;
    for (const el of document.querySelectorAll(${JSON.stringify(tag)})) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || !ok(el)) continue;
      const len = el.textContent.length;
      if (len < bestLen) { best = el; bestLen = len; }
    }
    if (!best) return null;
    best.scrollIntoView({ block: "center" });
    const r = best.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!pos) throw new Error("Nothing to click with text: " + text);
  await clickAt(c, pos.x, pos.y);
}
async function typeInto(c, selector, text) {
  const pos = await c.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.focus(); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!pos) throw new Error("No field: " + selector);
  await clickAt(c, pos.x, pos.y);
  await c.send("Input.insertText", { text });
}
async function pressEnter(c) {
  for (const type of ["keyDown", "keyUp"]) await c.send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: type === "keyDown" ? "\r" : undefined });
}
async function shot(c, name) {
  const r = await c.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(r.data, "base64"));
}
async function unlock(c, pin) {
  await waitFor(c, "document.body.innerText.length > 20", "app drawn");
  if ((await textNow(c)).includes("Enter password to continue")) {
    await typeInto(c, "input[type=password]", pin);
    await pressEnter(c);
    await waitFor(c, "!document.body.innerText.includes('Enter password to continue')", "unlocked");
    await sleep(400);
  }
}
const stateOf = (key) => `(() => { const v = localStorage.getItem(${JSON.stringify(key)}); return v ? JSON.parse(v).state : null; })()`;
async function counts(c) {
  return c.eval(`({ bills: ${stateOf("cuebill-bills")}.bills.length, deleted: ${stateOf("cuebill-bills")}.deletedBills.length, customers: ${stateOf("cuebill-customers")}.customers.length, orders: ${stateOf("cuebill-orders")}.orders.length, menu: ${stateOf("cuebill-menu")}.items.length })`);
}
const newest = (dir, ext) => {
  const f = fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(ext));
  return f.length ? path.join(dir, f.sort().pop()) : null;
};

(async () => {
  const expected = (() => {
    const f = path.join(__dirname, "pack-data", "initial-data", "cuebill-data-backup.json");
    if (!fs.existsSync(f)) return null;
    const b = JSON.parse(fs.readFileSync(f, "utf8"));
    const st = (k) => JSON.parse(b[k]).state;
    return { bills: st("cuebill-bills").bills.length, deleted: st("cuebill-bills").deletedBills.length, customers: st("cuebill-customers").customers.length, orders: st("cuebill-orders").orders.length, menu: st("cuebill-menu").items.length, pin: st("cuebill-settings").appPassword };
  })();
  console.log("expected from the packed data:", expected);

  // ================= run 1: first start =================
  console.log("\n== Run 1: first start ==");
  launch();
  let c = await connect();
  await unlock(c, expected ? expected.pin : "0000");
  await sleep(1500);
  const got = await c.eval(`({ hasBridge: typeof window.__cuebillStorage === "object", keys: Object.keys(window.localStorage).length, len: localStorage.length, bills: localStorage.getItem("cuebill-bills") ? localStorage.getItem("cuebill-bills").length : 0 })`);
  check("desktop bridge present, storage replaced", got.hasBridge && got.len >= 7 && got.bills > 1e6, JSON.stringify(got));
  const n1 = await counts(c);
  console.log("loaded:", n1);
  if (expected) check("old data loaded: bills / deleted / customers / orders / menu match", ["bills", "deleted", "customers", "orders", "menu"].every((k) => n1[k] === expected[k]), JSON.stringify(n1));
  check("shop home screen drawn", (await textNow(c)).length > 50);
  await shot(c, "1-home");
  const onDisk = fs.readdirSync(path.join(DATA, "Data")).filter((f) => f.endsWith(".json"));
  check("data files exist on disk (one per item)", onDisk.length >= 7, onDisk.join(","));
  check("daily backup written", !!newest(path.join(DATA, "Backups"), ".json"));
  check("old-data PDF copied next to the data", !!newest(path.join(DATA, "Purana-Data-PDF"), ".pdf"));
  check("no page errors on start", c.errors.length === 0, c.errors.join(" | "));

  // ---- reports: Excel + PDF ----
  step("reports");
  await c.eval(`location.assign("app://cuebill/reports")`);
  await sleep(1200);
  await unlock(c, expected ? expected.pin : "0000");
  await clickText(c, "Din ka Hisaab (PDF jaisa)", { exact: false });
  await waitFor(c, "!!document.querySelector('.hisaab-overlay')", "Hisaab Report open");
  await sleep(800);
  await shot(c, "2-hisaab");
  step("hisaab excel");
  await clickText(c, "Excel");
  await sleep(2500);
  const hisaabXlsx = newest(DL, ".xlsx");
  check("Hisaab Excel downloaded from inside the app", !!hisaabXlsx && fs.statSync(hisaabXlsx).size > 5000, String(hisaabXlsx));
  step("hisaab pdf");
  await clickText(c, "PDF / Print", { exact: false });
  await sleep(3000);
  const pdf = newest(DL, ".pdf");
  check("PDF saved by the PDF / Print button", !!pdf && fs.statSync(pdf).size > 3000, String(pdf));
  if (pdf) fs.copyFileSync(pdf, path.join(SHOTS, "hisaab-from-app.pdf"));
  await c.eval(`document.querySelector(".hisaab-overlay button[aria-label=Close]")?.click()`);

  // ---- settings: full Excel export ----
  step("settings export");
  await c.eval(`location.assign("app://cuebill/settings")`);
  await sleep(1200);
  await unlock(c, expected ? expected.pin : "0000");
  await clickText(c, "Export Data (Excel)", { exact: false });
  await sleep(500);
  step("clicking download");
  await clickText(c, "Download Excel File", { exact: false });
  let full;
  for (let i = 0; i < 40 && !full; i++) {
    await sleep(1000);
    full = fs.readdirSync(DL).filter((f) => /^cuebill-data-.*\.xlsx$/.test(f))[0];
  }
  await sleep(1000); // let the file finish writing
  check("full data Excel downloaded (Settings -> Export)", !!full && fs.statSync(path.join(DL, full)).size > 50000, String(full));
  if (full) {
    const XLSX = require(path.join(__dirname, "..", "node_modules", "xlsx"));
    const wb = XLSX.readFile(path.join(DL, full));
    check("Excel has the Credit hisaab sheets first", wb.SheetNames[0].startsWith("Credit hisaab"), wb.SheetNames.slice(0, 3).join(","));
  }
  await c.eval(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);

  // ---- a real write through the screen: add a customer ----
  step("add customer");
  await c.eval(`location.assign("app://cuebill/customers")`);
  await sleep(1200);
  await unlock(c, expected ? expected.pin : "0000");
  await clickText(c, "Add customer", { exact: false });
  await sleep(500);
  await typeInto(c, 'input[placeholder="Name"]', "Offline Test Customer");
  await clickText(c, "Save", { exact: true, tag: "button" });
  await sleep(800);
  const n2 = await counts(c);
  check("customer added on screen", n2.customers === n1.customers + 1, JSON.stringify(n2));

  // ---- network: nothing may have left the app ----
  const outside = c.requests.filter((u) => !/^(app|data|blob|devtools):/.test(u));
  check("no request went outside the app", outside.length === 0, outside.join(", "));
  check("no page errors during the session", c.errors.length === 0, c.errors.join(" | "));

  // close the normal way (window close)
  await c.eval(`localStorage.setItem("cuebill-test-close", "closed-normally")`);
  c.send("Runtime.evaluate", { expression: "window.close()" }).catch(() => {});
  c.close();
  check("app exits when its window is closed", await waitExit());
  proc = null;

  // ================= run 2: after a normal close =================
  console.log("\n== Run 2: after a normal close ==");
  launch();
  c = await connect();
  await unlock(c, expected ? expected.pin : "0000");
  const n3 = await c.eval(`({ customers: ${stateOf("cuebill-customers")}.customers.length, has: ${stateOf("cuebill-customers")}.customers.some(x => x.name === "Offline Test Customer"), test: localStorage.getItem("cuebill-test-close") })`);
  check("the customer added last time is still there", n3.has && n3.customers === n1.customers + 1, JSON.stringify(n3));
  check("a value saved right before closing is still there", n3.test === "closed-normally");
  check("last-close backup was made", fs.existsSync(path.join(DATA, "Backups", "cuebill-backup-last-close.json")));

  // hard kill right after a write (power-cut style)
  await c.eval(`localStorage.setItem("cuebill-test-kill", "survived")`);
  await sleep(900);
  c.close();
  hardKill();
  await sleep(1500);

  // ================= run 3: after a hard kill =================
  console.log("\n== Run 3: after the app was killed ==");
  launch();
  c = await connect();
  await unlock(c, expected ? expected.pin : "0000");
  const k = await c.eval(`localStorage.getItem("cuebill-test-kill")`);
  check("a write survives the app being killed a second later", k === "survived", String(k));
  c.close();
  hardKill();
  await sleep(1500);

  // ================= run 4: damaged file =================
  console.log("\n== Run 4: a damaged data file ==");
  const billsFile = path.join(DATA, "Data", "cuebill-bills.json");
  fs.writeFileSync(billsFile, fs.readFileSync(billsFile, "utf8").slice(0, 100000)); // cut off like a bad shutdown
  launch();
  c = await connect();
  await unlock(c, expected ? expected.pin : "0000");
  const n4 = await counts(c);
  check("damaged bills file is repaired automatically (same bills as before)", n4.bills === n1.bills && n4.customers === n1.customers + 1, JSON.stringify(n4));
  const log = fs.readFileSync(path.join(DATA, "cuebill-log.txt"), "utf8");
  check("the repair is written in the log", /pichhla save|backup se/.test(log));
  c.close();
  hardKill();
  await sleep(1500);

  // ================= run 5: restore from a backup file (how data moves to a new PC) =================
  if (expected) {
    console.log("\n== Run 5: Settings -> Backup & Restore -> Restore ==");
    launch();
    c = await connect();
    await unlock(c, expected.pin);
    const adminPin = await c.eval(`${stateOf("cuebill-settings")}.adminPin`);
    await c.eval(`location.assign("app://cuebill/settings")`);
    await sleep(1200);
    await unlock(c, expected.pin);
    await clickText(c, "Backup & Restore", { exact: false, tag: "p" });
    await sleep(500);
    await typeInto(c, 'input[placeholder="Admin PIN"]', adminPin);
    await pressEnter(c);
    await sleep(600);
    // pick the original backup file in the hidden file input
    const doc = await c.send("DOM.getDocument", {});
    const q = await c.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "input[type=file]" });
    await c.send("DOM.setFileInputFiles", { nodeId: q.nodeId, files: [path.join(__dirname, "pack-data", "initial-data", "cuebill-data-backup.json")] });
    await sleep(1200);
    await clickText(c, "Restore", { exact: true, tag: "button" });
    await sleep(3500);
    await unlock(c, expected.pin);
    const n5 = await counts(c);
    check("Restore brings the backup's data back (test customer gone, 277 again)", n5.customers === expected.customers && n5.bills === expected.bills && n5.orders === expected.orders, JSON.stringify(n5));
    const diskCustomers = JSON.parse(JSON.parse(fs.readFileSync(path.join(DATA, "Data", "cuebill-customers.json"), "utf8")).v).state.customers.length;
    check("...and it is saved on disk, not just on screen", diskCustomers === expected.customers, String(diskCustomers));
    c.close();
    hardKill();
  }

  console.log(failed === 0 ? "\nALL APP CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
  console.log("Screenshots and downloads:", WORK);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error("TEST CRASHED:", e);
  hardKill();
  process.exit(2);
});
