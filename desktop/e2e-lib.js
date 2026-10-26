// Shared helpers for the end-to-end tests: start the real app on a scratch data folder and drive it
// through its debug port (no extra packages - Node's own WebSocket).
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function harness({ work, exe, port = 9334 }) {
  const DATA = path.join(work, "data");
  const USER = path.join(work, "user");
  const DL = path.join(work, "downloads");
  const SHOTS = path.join(work, "shots");
  for (const d of [DATA, USER, DL, SHOTS]) fs.mkdirSync(d, { recursive: true });
  let proc = null;
  let failed = 0;

  const check = (name, ok, extra = "") => {
    if (!ok) failed++;
    console.log(ok ? "OK  " : "FAIL", name, ok ? "" : extra);
  };

  function launch() {
    const env = { ...process.env, CUEBILL_DATA_DIR: DATA, CUEBILL_USER_DATA: USER, CUEBILL_DEBUG_PORT: String(port), CUEBILL_AUTO_DOWNLOAD_DIR: DL };
    const cmd = exe || path.join(__dirname, "node_modules", "electron", "dist", "electron.exe");
    proc = spawn(cmd, exe ? [] : ["."], { cwd: __dirname, env, stdio: "ignore" });
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

  class Cdp {
    constructor(url) {
      this.url = url;
      this.id = 0;
      this.pending = new Map();
      this.handlers = [];
      this.errors = [];
      this.requests = [];
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
        } else if (m.method) {
          if (m.method === "Runtime.exceptionThrown") this.errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
          if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") this.errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
          if (m.method === "Network.requestWillBeSent") this.requests.push(m.params.request.url);
        }
      };
    }
    send(method, params = {}) {
      const id = ++this.id;
      this.ws.send(JSON.stringify({ id, method, params }));
      return new Promise((res, rej) => this.pending.set(id, { res, rej }));
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
        /* gone */
      }
    }
  }

  async function connect() {
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const page = list.find((t) => t.type === "page" && t.url.startsWith("app://"));
        if (page) {
          const c = new Cdp(page.webSocketDebuggerUrl);
          await c.open();
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

  const text = (c) => c.eval("document.body.innerText");
  async function waitFor(c, test, label, ms = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try {
        if (await c.eval(test)) return true;
      } catch {
        /* reloading */
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
  // click the smallest visible element whose text is exactly / contains `want`
  async function clickText(c, want, { exact = true, tag = "button, a, [role=button], div, span, p, h3, label" } = {}) {
    const pos = await c.eval(`(() => {
      const want = ${JSON.stringify(want)}, exact = ${exact};
      const ok = (el) => { const t = el.textContent.trim().replace(/\\s+/g, " "); return exact ? t === want : t.includes(want); };
      let best = null, bestLen = 1e9;
      for (const el of document.querySelectorAll(${JSON.stringify(tag)})) {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2 || !ok(el)) continue;
        if (el.disabled) continue;
        const len = el.textContent.length;
        if (len < bestLen) { best = el; bestLen = len; }
      }
      if (!best) return null;
      best.scrollIntoView({ block: "center" });
      const r = best.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!pos) throw new Error("Nothing to click with text: " + want);
    await clickAt(c, pos.x, pos.y);
  }
  async function typeInto(c, selector, value) {
    const pos = await c.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.focus(); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!pos) throw new Error("No field: " + selector);
    await clickAt(c, pos.x, pos.y);
    await c.send("Input.insertText", { text: value });
  }
  // replace what is in the n-th number box that is on screen
  async function setNumber(c, index, value) {
    const pos = await c.eval(`(() => {
      const els = [...document.querySelectorAll("input[type=number]")].filter((e) => e.getBoundingClientRect().width > 0);
      const el = els[${index}];
      if (!el) return null;
      el.scrollIntoView({ block: "center" });
      el.focus();
      el.select();
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!pos) throw new Error("No number box #" + index);
    await clickAt(c, pos.x, pos.y);
    await c.eval(`document.activeElement && document.activeElement.select && document.activeElement.select()`);
    await c.send("Input.insertText", { text: String(value) });
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
    if ((await text(c)).includes("Enter password to continue")) {
      await typeInto(c, "input[type=password]", pin);
      await pressEnter(c);
      await waitFor(c, "!document.body.innerText.includes('Enter password to continue')", "unlocked");
      await sleep(400);
    }
  }
  async function go(c, route, pin) {
    await c.eval(`location.assign("app://cuebill${route}")`);
    await sleep(1200);
    await unlock(c, pin);
  }
  const stateOf = (key) => `(() => { const v = localStorage.getItem(${JSON.stringify(key)}); return v ? JSON.parse(v).state : null; })()`;
  const newest = (dir, ext) => {
    const f = fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(ext));
    return f.length ? path.join(dir, f.sort().pop()) : null;
  };

  return {
    DATA, USER, DL, SHOTS, sleep, check, launch, hardKill, waitExit, connect, text, waitFor, clickAt, clickText, typeInto, setNumber,
    pressEnter, shot, unlock, go, stateOf, newest, failures: () => failed,
  };
}

module.exports = { harness, sleep };
