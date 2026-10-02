import fs from "fs";
import path from "path";
import { loadAll } from "./load-data";
import { creditHisaab, creditHisaabSheetRows, creditPendingReport, creditPendingSheetRows, creditParts, creditSettlementDetails } from "../../src/lib/billing";
import { normalizeName } from "../../src/lib/customerName";
import { toDateInputValue } from "../../src/lib/format";

const { customers, orders, bills, menuItems, menuCategories, tables } = loadAll();
const live = bills.filter((b) => b.status !== "cancelled");
const r2 = (n: number) => Math.round(n * 100) / 100;

// exactly what the app's export passes: creditHisaab gets non-cancelled bills, creditPendingReport gets the store's bills
const h = creditHisaab(live, menuItems, menuCategories, tables, customers);
const rep = creditPendingReport(bills, customers, orders);

// every customer with any credit activity: diya / settle / baaki (same rules as the app's own balance)
const real = customers.filter((c) => !c.isWalkIn);
const all = real
  .map((c) => ({ name: c.name, ...creditParts(live, c.id, normalizeName(c.name)) }))
  .filter((r) => r.given > 0 || r.settled > 0);
for (const n of rep.noProfile) all.push({ name: n.name + " (profile nahi)", given: 0, settled: 0, balance: n.amount }); // given/settled for these shown via balance only
all.sort((a, b) => b.balance - a.balance || b.given - a.given);

const settlements = creditSettlementDetails(live, customers)
  .sort((a, b) => a.date - b.date)
  .map((r) => ({ t: r.date, date: toDateInputValue(r.date), name: r.customerName, cash: r.cash, upi: r.upi, disc: r.discount, amount: r.amount }));

const perDay = new Map<string, { n: number; cash: number; upi: number; disc: number }>();
for (const s of settlements) {
  const d = perDay.get(s.date) ?? { n: 0, cash: 0, upi: 0, disc: 0 };
  d.n++; d.cash += s.cash; d.upi += s.upi; d.disc += s.disc; perDay.set(s.date, d);
}

fs.writeFileSync(path.join(__dirname, "data", "credit2.json"), JSON.stringify({
  asOf: new Date().toISOString(),
  h, rep,
  hisaabSheet: creditHisaabSheetRows(h),
  pendingSheet: creditPendingSheetRows(rep),
  customers: all,
  settlements,
  perDay: [...perDay.entries()].map(([date, v]) => ({ date, n: v.n, cash: r2(v.cash), upi: r2(v.upi), disc: r2(v.disc) })),
}, null, 1));
console.log("hisaab sheet rows:");
for (const r of creditHisaabSheetRows(h)) console.log(JSON.stringify(r));
console.log("\npending sheet (first 6 + last 22):");
const ps = creditPendingSheetRows(rep);
for (const r of [...ps.slice(0, 6), { Naam: "..." }, ...ps.slice(-22)]) console.log(JSON.stringify(r));
console.log("\ncustomers:", all.length, "settlements:", settlements.length, "orphan settle names:", [...new Set(settlements.map((s) => s.name).filter((n) => /Delete hua|Walk-in/.test(n)))].length);
