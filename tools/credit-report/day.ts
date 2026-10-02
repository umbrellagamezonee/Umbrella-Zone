// One day's report: that day's cash / account / credit, who took credit and
// who paid old credit, and every canteen item category by category.
//   npx tsx day.ts 2026-10-01
import fs from "fs";
import path from "path";
import { loadAll } from "./load-data";
import {
  creditHisaab,
  dailyCollectionRows,
  gallaByDate,
  categoryStockProfit,
  REPORT_CATEGORIES,
} from "../../src/lib/billing";
import { isCreditSettlement, settlementPersonName } from "../../src/lib/billLabel";
import { toDateInputValue, formatDateKey, dateInputValueToIstMidnight } from "../../src/lib/format";

const date = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) throw new Error("Date do, jaise: npx tsx day.ts 2026-10-01");

const { customers, orders, bills, menuItems, menuCategories, tables, expenses } = loadAll();
const live = bills.filter((b) => b.status !== "cancelled");
const r2 = (n: number) => Math.round(n * 100) / 100;
const dayStart = dateInputValueToIstMidnight(date);
const dayEnd = dayStart + 86_400_000;
const label = formatDateKey(date, { day: "numeric", month: "long" });

// --- credit hisaab for the day (same function as the app's Credit hisaab sheet) ---
const h = creditHisaab(live, menuItems, menuCategories, tables, customers, -Infinity, dayEnd);
const day = h.days.find((d) => d.dateKey === date) ?? {
  dateKey: date, label, cash: 0, upi: 0, issued: 0, settled: 0, pending: 0, untracedCash: 0, untracedUpi: 0, people: [],
};

// --- galla for the day (same as the Galla Summary screen) ---
const galla = gallaByDate(live).get(date) ?? { freshCash: 0, freshUpi: 0, settledCash: 0, settledUpi: 0, forgiven: 0, settledCount: 0, creditGiven: 0 };
const dayExpenses = expenses.filter((e) => toDateInputValue(e.createdAt) === date);

// --- who paid old credit that day ---
const customerById = new Map(customers.map((c) => [c.id, c]));
const settlements = live
  .filter((b) => b.status === "paid" && isCreditSettlement(b) && toDateInputValue(b.createdAt) === date)
  .sort((a, b) => a.createdAt - b.createdAt)
  .map((b) => ({ t: b.createdAt, name: settlementPersonName(b, customerById.get(b.customerId)), cash: b.amountCash, upi: b.amountUpi, disc: b.discount }));

// --- table / category rows of the day (Daily collection block) ---
const dailyRows = (dailyCollectionRows(live, menuItems, menuCategories, tables, customers, -Infinity, dayEnd) as any[]).filter((r) => r.Date === label);

// --- canteen: items sold that day, category by category ---
const dayOrders = orders.filter((o) => o.createdAt >= dayStart && o.createdAt < dayEnd);
const dayExpensesInRange = expenses.filter((e) => e.createdAt >= dayStart && e.createdAt < dayEnd);
const cats = categoryStockProfit(dayOrders, dayExpensesInRange, menuItems, menuCategories);
const SHEET_TO_ROW_LABEL: Record<string, string> = {};
for (const rc of REPORT_CATEGORIES) SHEET_TO_ROW_LABEL[rc.categoryName] = rc.sheet.replace(" collection", "");
const rowFor = (item: string) => dailyRows.find((r) => r.Item === item);
const knownIds = new Set(menuItems.map((i) => i.id));

const canteen = cats.map((c) => {
  // one line per menu item, exactly like the app's own category sheets — two menu
  // entries that happen to share a name (e.g. Dairy milk at two prices) stay two lines
  const items = c.itemRows
    .map((r) => ({
      name: r.name.trim(),
      price: String(r.price),
      qty: r.qtySold,
      revenue: r2(r.revenue),
      left: r.remainingQty,
      profit: r.marginPerUnit == null ? null : r2(r.marginPerUnit * r.qtySold),
      profitPartial: false,
    }))
    .sort((a, b) => b.revenue - a.revenue || b.qty - a.qty || a.name.localeCompare(b.name));
  const pay = rowFor(SHEET_TO_ROW_LABEL[c.categoryName]);
  const billed = dayOrders.filter((o) => o.status === "billed");
  let notBilled = 0;
  for (const o of dayOrders) {
    if (o.status === "billed") continue;
    for (const l of o.items || []) {
      const it = menuItems.find((i) => i.id === l.menuItemId);
      if (it && menuCategories.find((x) => x.id === it.categoryId)?.name === c.categoryName) notBilled += l.qty * l.price;
    }
  }
  void billed;
  return {
    name: c.categoryName,
    sale: r2(c.sale),
    soldQty: items.reduce((s, i) => s + i.qty, 0),
    purchase: r2(c.purchase),
    cash: pay ? Number(pay.Cash) : 0,
    upi: pay ? Number(pay.Account) : 0,
    credit: pay ? Number(pay.Credit) : 0,
    notBilled: r2(notBilled),
    items,
  };
});
// order lines whose menu item has since been deleted
let orphanSale = 0;
for (const o of dayOrders) for (const l of o.items || []) if (!knownIds.has(l.menuItemId)) orphanSale += l.qty * l.price;

const out = {
  date, label, asOf: new Date().toISOString(),
  day, galla, expenses: dayExpenses.map((e) => ({ category: e.category, note: e.note, amount: e.amount })),
  settlements, dailyRows: dailyRows.map((r) => ({ item: r.Item, total: r["Total collection"], cash: r.Cash, upi: r.Account, credit: r.Credit })),
  canteen, orphanSale: r2(orphanSale), ordersCount: dayOrders.length,
};
fs.writeFileSync(path.join(__dirname, "data", `day-${date}.json`), JSON.stringify(out, null, 1));

// --- checks printed for me ---
const sumP = (k: "issued" | "settled" | "pending") => r2(day.people.reduce((s: number, p: any) => s + p[k], 0));
console.log(label, "| Cash", day.cash, "Account", day.upi, "Diya", day.issued, "Settle", day.settled, "Baaki", day.pending);
console.log("people sum: diya", sumP("issued"), "settle", sumP("settled"), "baaki", sumP("pending"), " (n=", day.people.length, ")");
const tot = dailyRows.find((r) => r.Item === "Total");
console.log("Daily-collection Total row:", tot && { cash: tot.Cash, upi: tot.Account, credit: tot.Credit });
console.log("galla:", JSON.stringify(galla), "settlements:", settlements.length, "sum cash/upi/disc:", r2(settlements.reduce((s, x) => s + x.cash, 0)), r2(settlements.reduce((s, x) => s + x.upi, 0)), r2(settlements.reduce((s, x) => s + x.disc, 0)));
for (const c of canteen) console.log(c.name.padEnd(10), "sale", c.sale, "qty", c.soldQty, "| billed cash", c.cash, "upi", c.upi, "credit", c.credit, "| notBilled", c.notBilled, "| fark", r2(c.sale - c.cash - c.upi - c.credit - c.notBilled));
console.log("orders that day:", dayOrders.length, "orphan (deleted menu item) sale:", r2(orphanSale));
