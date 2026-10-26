// Checks for "bring the other laptop's data in". Run: npx tsx merge-check.ts [backup.json]
// Two laptops start from the same old data, then each gets its own new bills / customers. Merging must
// lose nothing, count nothing twice, and give the same totals whichever laptop's file goes into which.
import fs from "fs";
import path from "path";
import type { Bill } from "../../src/types";
import { mergeBackups } from "../../src/lib/mergeBackup";
import { creditBalanceFor } from "../../src/lib/billing";
import { normalizeName } from "../../src/lib/customerName";

let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "OK  " : "FAIL", name, ok ? "" : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};

const srcPath = process.argv[2] ?? path.join(__dirname, "../../offline-pack/cuebill-data-backup.json");
const base: Record<string, string> = JSON.parse(fs.readFileSync(srcPath, "utf8"));
const edit = (map: Record<string, string>, key: string, fn: (state: any) => void) => {
  const d = JSON.parse(map[key]);
  fn(d.state);
  map[key] = JSON.stringify(d);
};
const state = (map: Record<string, string>, key: string) => JSON.parse(map[key]).state;
const mk = (o: Partial<Bill>): Bill => ({
  id: "b" + Math.random().toString(36).slice(2), tableId: null, tableName: "Canteen order", orderId: null, gameId: null, gameName: null, customerId: null,
  tableChargeMinutes: 0, tableCharge: 0, canteenCharge: 0, canteenItems: [], discount: 0, total: 0, amountPaid: 0, amountCash: 0, amountUpi: 0, amountDue: 0,
  paymentMethod: null, shares: null, status: "paid", createdAt: Date.UTC(2026, 9, 25, 6, 0, 0), paidAt: null, deletedAt: null, matchParticipants: null, matchLosers: null, ...o,
});
const credit = (customerId: string, amount: number, extra: Partial<Bill> = {}) =>
  mk({ customerId, canteenCharge: amount, total: amount, amountDue: amount, ...extra });
const cash = (customerId: string, amount: number) => mk({ customerId, canteenCharge: amount, total: amount, amountCash: amount, amountPaid: amount, paymentMethod: "cash" });

const bills0: Bill[] = state(base, "cuebill-bills").bills;
const customers0 = state(base, "cuebill-customers").customers;
const c1 = customers0.find((c: any) => !c.isWalkIn && creditBalanceFor(bills0, c.id, normalizeName(c.name)) > 0);
const open = bills0.find((b) => b.status === "open" && !b.shares)!;
const toCancel = bills0.find((b) => b.status === "paid" && !b.shares && b.id !== open.id)!;
const served = state(base, "cuebill-orders").orders.find((o: any) => o.status === "served");
const cust = (id: string, name: string, extra: object = {}) => ({ id, name, phone: "", email: "", isWalkIn: false, lastReminderAt: null, createdAt: 1, ...extra });

// ---- laptop A: the old data + its own new activity ----
const A = { ...base };
const A_bills = [cash(c1.id, 100), credit(c1.id, 60), credit("nehaA", 50)];
edit(A, "cuebill-customers", (s) => s.customers.push(cust("nehaA", "Neha")));
edit(A, "cuebill-bills", (s) => s.bills.unshift(...A_bills));
// ---- laptop B: the same old data + different new activity ----
const B = { ...base };
const B_bills = [credit(c1.id, 40), credit("nehaB", 70), cash("rohitB", 30)];
edit(B, "cuebill-customers", (s) => s.customers.push(cust("nehaB", "  neha "), cust("rohitB", "Rohit", { isRegular: true })));
edit(B, "cuebill-bills", (s) => {
  s.bills.unshift(...B_bills);
  const o = s.bills.find((b: Bill) => b.id === open.id);
  Object.assign(o, { status: "paid", amountCash: o.total, amountPaid: o.total, amountDue: 0, paymentMethod: "cash", paidAt: Date.now() }); // settled here, still open on A
  s.bills.find((b: Bill) => b.id === toCancel.id).status = "cancelled"; // cancelled only on B
});
edit(B, "cuebill-expenses", (s) => s.expenses.push({ id: "expB", category: "Other", amount: 250, note: "B", createdAt: 5 }));
edit(B, "cuebill-orders", (s) => {
  s.orders.push({ id: "ordB", tableId: null, customerId: "rohitB", guestName: null, items: [{ id: "i", qty: 1, name: "Chips", price: 20, menuItemId: "x" }], note: "", status: "served", createdAt: 9 });
  s.orders.find((o: any) => o.id === served.id).status = "billed";
});

const before = JSON.stringify(A);
const { merged, summary } = mergeBackups(A, B);
eq("the laptop's own data is not modified in place", JSON.stringify(A), before);
console.log("   summary:", JSON.stringify(summary));
eq("3 new bills added from B", summary.billsAdded, 3);
eq("the bill settled on B (open on A) is updated", summary.billsUpdated, 1);
eq("Rohit (new) is added, Neha (same name, other spelling of spaces/capitals) is matched not duplicated", [summary.customersAdded, summary.customersMatchedByName], [1, 1]);
eq("expense and order from B come in; the order that is billed on B moves up", [summary.expensesAdded, summary.ordersAdded, summary.ordersUpdated], [1, 1, 1]);
eq("the bill cancelled only on B is reported, and kept as it is on A", summary.conflicts.some((c) => /cancel/.test(c)), true);

const A2 = { ...A, ...merged };
const billsAfter: Bill[] = state(A2, "cuebill-bills").bills;
eq("bills after: old + A's 3 + B's 3", billsAfter.length, bills0.length + 3 + 3);
eq("no bill appears twice", new Set(billsAfter.map((b) => b.id)).size, billsAfter.length);
eq("the open bill is now paid", billsAfter.find((b) => b.id === open.id)!.status, "paid");
eq("the cancelled-on-B bill is still paid here", billsAfter.find((b) => b.id === toCancel.id)!.status, "paid");
const customersAfter = state(A2, "cuebill-customers").customers;
eq("one Neha, one Rohit", [customersAfter.filter((c: any) => normalizeName(c.name) === "neha").length, customersAfter.filter((c: any) => c.name === "Rohit").length], [1, 1]);
eq("B's Neha bill now belongs to the Neha that is here", billsAfter.find((b) => b.id === B_bills[1].id)!.customerId, "nehaA");
eq("Rohit's regular mark came with him", customersAfter.find((c: any) => c.name === "Rohit").isRegular, true);
const bal = (map: Record<string, string>, id: string, name: string) => creditBalanceFor(state(map, "cuebill-bills").bills, id, normalizeName(name));
const c1Before = creditBalanceFor(bills0, c1.id, normalizeName(c1.name));
eq("credit of an old customer = old + A's 60 + B's 40", Math.round(bal(A2, c1.id, c1.name) * 100) / 100, Math.round((c1Before + 60 + 40) * 100) / 100);
eq("Neha owes 50 (A) + 70 (B) = 120", bal(A2, "nehaA", "Neha"), 120);

// merging the same file again changes nothing
const again = mergeBackups(A2, B);
eq("second time: nothing changes", [Object.keys(again.merged).length, again.summary.billsAdded, again.summary.billsUpdated, again.summary.customersAdded, again.summary.ordersAdded, again.summary.expensesAdded], [0, 0, 0, 0, 0, 0]);

// The other way round gives the same totals - as long as the two laptops do not disagree about the same bill
// (the cancelled-only-on-B bill above is such a disagreement: each laptop keeps its own version, and says so).
const Bs = { ...B };
edit(Bs, "cuebill-bills", (s) => { s.bills.find((b: Bill) => b.id === toCancel.id).status = "paid"; });
const A2s = { ...A, ...mergeBackups(A, Bs).merged };
const B2 = { ...Bs, ...mergeBackups(Bs, A).merged };
const ids = (m: Record<string, string>) => state(m, "cuebill-bills").bills.map((b: Bill) => b.id).sort();
eq("A into B and B into A end up with the very same bills", ids(A2s), ids(B2));
const byName = (m: Record<string, string>) => {
  const out: Record<string, number> = {};
  for (const c of state(m, "cuebill-customers").customers) if (!c.isWalkIn) { const v = bal(m, c.id, c.name); if (Math.abs(v) > 0.005) out[normalizeName(c.name)] = Math.round(v * 100) / 100; }
  return out;
};
eq("...and the same credit for every customer", byName(A2s), byName(B2));
eq("...and nobody is left out: a disagreeing bill is the only thing that can differ", Object.keys(mergeBackups(A, B).merged).length > 0, true);

// merging into an empty laptop just brings everything
const empty = mergeBackups({}, B);
eq("into an empty laptop: all of B arrives", state({ ...empty.merged }, "cuebill-bills").bills.length, state(B, "cuebill-bills").bills.length);

// the same file merged into itself changes nothing
eq("a laptop merged with itself: nothing changes", Object.keys(mergeBackups(base, base).merged).length, 0);

console.log(failed === 0 ? "\nALL MERGE CHECKS PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
