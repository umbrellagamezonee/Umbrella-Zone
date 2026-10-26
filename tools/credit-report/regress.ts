// Guards the OLD data: takes a snapshot of what the report functions say about a backup
// file, and later checks that the code still says exactly the same about it.
//   npx tsx regress.ts snapshot <out.json> [backup.json]
//   npx tsx regress.ts compare  <snapshot.json> [backup.json]
// "compare" lets new fields appear (extra keys are fine) but no old number may change.
import fs from "fs";
import path from "path";
import { dailyCollectionRows, creditHisaab, creditPendingReport, gallaByDate, creditSettlementDetails, creditParts, billCollectedByPart, billMoney } from "../../src/lib/billing";
import { buildDayReport } from "../../src/lib/dayReport";
import { buildLedger, monthlyCreditByCustomer } from "../../src/lib/ledger";
import { customerPendingOrders } from "../../src/lib/billing";
import { normalizeName } from "../../src/lib/customerName";
import { toDateInputValue } from "../../src/lib/format";

const mode = process.argv[2];
const file = process.argv[3];
const srcPath = process.argv[4] ?? path.join(__dirname, "../../offline-pack/cuebill-data-backup.json");
if ((mode !== "snapshot" && mode !== "compare") || !file) throw new Error("Use: snapshot <out.json> | compare <snapshot.json>");

const raw = JSON.parse(fs.readFileSync(srcPath, "utf8"));
const st = (k: string) => JSON.parse(raw[k]).state;
const bills: any[] = st("cuebill-bills").bills;
const orders: any[] = st("cuebill-orders").orders;
const customers: any[] = st("cuebill-customers").customers;
const menu = st("cuebill-menu");
const tables: any[] = st("cuebill-tables").tables;
const expenses: any[] = st("cuebill-expenses").expenses;
const live = bills.filter((b) => b.status !== "cancelled");

const times = bills.map((b) => b.createdAt as number);
const days: string[] = [];
for (let t = Math.min(...times); t <= Math.max(...times) + 86_400_000; t += 86_400_000) days.push(toDateInputValue(t));
const uniqueDays = [...new Set(days)];

const snap: Record<string, unknown> = {};
snap.dailyCollectionRows = dailyCollectionRows(live, menu.items, menu.categories, tables, customers);
snap.creditHisaab = creditHisaab(live, menu.items, menu.categories, tables, customers);
snap.creditPendingReport = creditPendingReport(bills, customers, orders);
snap.galla = [...gallaByDate(live).entries()].sort();
snap.settlements = creditSettlementDetails(live, customers);
snap.dayReports = Object.fromEntries(
  uniqueDays.map((d) => [d, buildDayReport({ date: d, bills, orders, expenses, menuItems: menu.items, menuCategories: menu.categories, tables, customers })])
);
snap.ledgers = Object.fromEntries(
  customers
    .filter((c) => !c.isWalkIn)
    .map((c) => {
      const nameKey = normalizeName(c.name);
      const mine = bills.filter((b) => (b.shares ? b.shares.some((s: any) => normalizeName(s.payerName) === nameKey) : b.customerId === c.id));
      const pending = customerPendingOrders(orders, bills, c.id);
      const entries = buildLedger(mine, pending, nameKey, orders).map((e) => ({ id: e.id, date: e.date, particulars: e.particulars, debit: e.debit, credit: e.credit, paidNow: e.paidNow, balanceAfter: e.balanceAfter }));
      return [c.id, { entries, parts: creditParts(live, c.id, nameKey) }];
    })
);
snap.monthly = ["2026-09", "2026-10"].map((m) => monthlyCreditByCustomer(bills, orders, customers, m));
snap.perBill = Object.fromEntries(bills.map((b) => [b.id, { money: billMoney(b), part: billCollectedByPart(b) }]));

// ---- plain JSON, with Maps flattened, so two runs can be compared ----
const plain = JSON.parse(JSON.stringify(snap, (_k, v) => (v instanceof Map ? [...v.entries()] : typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v)));

function covers(base: unknown, now: unknown, where: string, out: string[]) {
  if (out.length >= 25) return;
  if (base !== null && typeof base === "object") {
    if (now === null || typeof now !== "object") return void out.push(`${where}: expected an object`);
    if (Array.isArray(base)) {
      if (!Array.isArray(now) || base.length !== now.length) return void out.push(`${where}: list length ${Array.isArray(now) ? now.length : "?"} != ${base.length}`);
      base.forEach((b, i) => covers(b, (now as unknown[])[i], `${where}[${i}]`, out));
    } else {
      for (const k of Object.keys(base as object)) covers((base as Record<string, unknown>)[k], (now as Record<string, unknown>)[k], `${where}.${k}`, out);
    }
    return;
  }
  if (typeof base === "number" && typeof now === "number") {
    if (Math.abs(base - now) > 1e-4) out.push(`${where}: ${now} != ${base}`);
    return;
  }
  if (base !== now) out.push(`${where}: ${JSON.stringify(now)} != ${JSON.stringify(base)}`);
}

if (mode === "snapshot") {
  fs.writeFileSync(file, JSON.stringify(plain));
  console.log(`snapshot saved: ${file}  (${bills.length} bills, ${customers.length} customers, ${uniqueDays.length} days)`);
} else {
  const base = JSON.parse(fs.readFileSync(file, "utf8"));
  const diffs: string[] = [];
  covers(base, plain, "$", diffs);
  if (diffs.length) {
    console.log("OLD DATA NUMBERS CHANGED:");
    diffs.forEach((d) => console.log("  " + d));
    process.exit(1);
  }
  console.log("OK - every old-data number is exactly the same as in the snapshot");
}
