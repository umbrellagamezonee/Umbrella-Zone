// Self-check for storage.js - run with: node test-storage.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DataStore, fileFor, keyFor, dayStamp } = require("./storage");

let failed = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "OK  " : "FAIL", name, ok ? "" : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cuebill-test-"));
const logs = [];
const log = (m) => logs.push(m);
const reopen = (root) => new DataStore(root, log);

// ---- file names round-trip ----
for (const k of ["cuebill-bills", "a.b/c d", "cuebill-install-banner-last-shown"]) eq("key <-> file name: " + k, keyFor(fileFor(k)), k);

// ---- save and reload ----
{
  const root = tmp();
  const s = reopen(root);
  eq("new folder is empty", s.isEmpty(), true);
  s.apply({ "cuebill-bills": '{"state":{"bills":[1,2,3]}}', "cuebill-settings": '{"a":"\\"quoted\\" ₹ हि"}' });
  s.flushNow();
  const again = reopen(root);
  eq("saved values come back exactly", again.snapshot(), s.snapshot());
  again.apply({ "cuebill-bills": null });
  again.flushNow();
  eq("removing a key sticks", Object.keys(reopen(root).snapshot()), ["cuebill-settings"]);
  eq("no temporary files left behind", fs.readdirSync(path.join(root, "Data")).filter((f) => f.endsWith(".tmp")), []);
}

// ---- debounced writes land on disk by themselves ----
(async () => {
  {
    const root = tmp();
    const s = reopen(root);
    s.apply({ "cuebill-x": "1" });
    eq("not written instantly", reopen(root).snapshot(), {});
    await new Promise((r) => setTimeout(r, 400));
    eq("written within a moment", reopen(root).snapshot(), { "cuebill-x": "1" });
  }

  // ---- damaged files ----
  {
    const root = tmp();
    const s = reopen(root);
    s.apply({ "cuebill-bills": "v1" });
    s.flushNow();
    s.apply({ "cuebill-bills": "v2" });
    s.flushNow();
    const file = path.join(root, "Data", fileFor("cuebill-bills"));
    eq("previous version is kept", JSON.parse(fs.readFileSync(file + ".prev", "utf8")).v, "v1");
    fs.writeFileSync(file, '{"k":"cuebill-bills","v":"v2-tru'); // cut off mid-write
    logs.length = 0;
    const r = reopen(root);
    eq("half-written file -> previous version used", r.snapshot(), { "cuebill-bills": "v1" });
    eq("...and it is mentioned in the log", logs.some((l) => l.includes("pichhla save")), true);
    eq("...and the file is repaired on disk", JSON.parse(fs.readFileSync(file, "utf8")).v, "v1");
  }
  {
    // both damaged -> latest backup
    const root = tmp();
    const s = reopen(root);
    s.apply({ "cuebill-bills": "good", "cuebill-customers": "c" });
    s.flushNow();
    s.dailyBackup();
    s.apply({ "cuebill-bills": "newer" });
    s.flushNow();
    const file = path.join(root, "Data", fileFor("cuebill-bills"));
    fs.writeFileSync(file, "garbage");
    fs.writeFileSync(file + ".prev", "garbage");
    const r = reopen(root);
    eq("both files damaged -> taken from backup", r.snapshot()["cuebill-bills"], "good");
    eq("other keys untouched", r.snapshot()["cuebill-customers"], "c");
  }
  {
    // the swap itself was interrupted: only .prev (and a stray .tmp) exist
    const root = tmp();
    const s = reopen(root);
    s.apply({ "cuebill-bills": "v1" });
    s.flushNow();
    s.apply({ "cuebill-bills": "v2" });
    s.flushNow();
    const file = path.join(root, "Data", fileFor("cuebill-bills"));
    fs.rmSync(file);
    fs.writeFileSync(file + ".tmp", "{half");
    eq("interrupted swap -> previous version used", reopen(root).snapshot(), { "cuebill-bills": "v1" });
  }

  // ---- backups ----
  {
    const root = tmp();
    const s = reopen(root);
    eq("no backup when there is no data", s.dailyBackup(), null);
    s.apply({ "cuebill-bills": "b", "other-key": "x" });
    s.flushNow();
    const f = s.dailyBackup();
    eq("daily backup is named for today", path.basename(f), `cuebill-backup-${dayStamp()}.json`);
    eq("backup has only cuebill keys, in the app's Backup format", JSON.parse(fs.readFileSync(f, "utf8")), { "cuebill-bills": "b" });
    s.apply({ "cuebill-bills": "changed" });
    s.dailyBackup();
    eq("first backup of the day is never overwritten", JSON.parse(fs.readFileSync(f, "utf8"))["cuebill-bills"], "b");
    s.closeBackup();
    eq("close backup has the latest", JSON.parse(fs.readFileSync(path.join(root, "Backups", "cuebill-backup-last-close.json"), "utf8"))["cuebill-bills"], "changed");
    for (let i = 1; i <= 30; i++) fs.writeFileSync(path.join(root, "Backups", `cuebill-backup-2026-01-${String(i).padStart(2, "0")}.json`), "{}");
    s.pruneBackups();
    const dated = fs.readdirSync(path.join(root, "Backups")).filter((n) => /\d{4}-\d{2}-\d{2}\.json$/.test(n));
    eq("only the newest 21 daily backups are kept", dated.length, 21);
    eq("...today's is among them", dated.includes(path.basename(f)), true);
  }

  // ---- import (first run) ----
  {
    const root = tmp();
    const s = reopen(root);
    const n = s.importBackup({ "cuebill-bills": "B", "cuebill-orders": "O", "not-ours": "z", "cuebill-bad": 5 });
    eq("import counts only valid cuebill keys", n, 2);
    eq("imported data is on disk", reopen(root).snapshot(), { "cuebill-bills": "B", "cuebill-orders": "O" });
  }

  // ---- big values ----
  {
    const root = tmp();
    const s = reopen(root);
    const big = JSON.stringify({ state: { bills: Array.from({ length: 20000 }, (_, i) => ({ id: "bill-" + i, note: "x".repeat(150) })) } });
    s.apply({ "cuebill-bills": big });
    s.flushNow();
    eq("a 4MB+ value round-trips", reopen(root).snapshot()["cuebill-bills"] === big, true);
  }

  console.log(failed === 0 ? "\nALL STORAGE TESTS PASSED" : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
