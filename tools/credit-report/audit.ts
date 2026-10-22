// One-off read-only audit of the live shop data (never writes anything).
import fs from "fs";
import path from "path";
import { loadAll } from "./load-data";
import { creditBalanceFor, orderTotal, customerPendingOrders } from "../../src/lib/billing";
import { normalizeName } from "../../src/lib/customerName";
import { isCreditSettlement } from "../../src/lib/billLabel";
import { formatDateTime, toDateInputValue } from "../../src/lib/format";

const raw = (f: string) => JSON.parse(fs.readFileSync(path.join(__dirname, "data", f), "utf8"));
const { customers, orders, bills, menuItems, menuCategories } = loadAll();
const rawBills = raw("final_bills.json");
const rawTables = raw("final_tables.json");
const rawItems = raw("final_menuitems.json");
const rawCust = raw("final_customers.json");
const r2 = (n: number) => Math.round(n * 100) / 100;
const now = Date.now();
const live = bills.filter((b) => b.status !== "cancelled");
const nm = (id: any) => customers.find((c) => c.id === id)?.name ?? (id ? "deleted:" + String(id).slice(0, 4) : "none");
const H = (t: string) => console.log("\n=== " + t);
const show = (rows: any[], n = 8) => rows.slice(0, n).forEach((r) => console.log("   ", typeof r === "string" ? r : JSON.stringify(r)));

H("COUNTS");
console.log("bills", bills.length, "(live", live.length + ")", "orders", orders.length, "customers", customers.length, "menu items", menuItems.length);

H("1. ORDERS");
const billByOrder = new Map<string, any[]>();
for (const b of bills) if (b.orderId) billByOrder.set(b.orderId, [...(billByOrder.get(b.orderId) ?? []), b]);
const billedNoBill = orders.filter((o) => o.status === "billed" && !(billByOrder.get(o.id) ?? []).some((b) => b.status !== "cancelled"));
const servedWithBill = orders.filter((o) => o.status !== "billed" && (billByOrder.get(o.id) ?? []).some((b) => b.status !== "cancelled"));
console.log("status 'billed' but NO live bill:", billedNoBill.length, "| total", r2(billedNoBill.reduce((s, o) => s + orderTotal(o), 0)));
show(billedNoBill.map((o) => `${formatDateTime(o.createdAt)} ${nm(o.customerId)} ${o.items.map((i: any) => i.name + "x" + i.qty).join(",")} = ${orderTotal(o)}`));
console.log("status not 'billed' but a bill EXISTS:", servedWithBill.length, "| total", r2(servedWithBill.reduce((s, o) => s + orderTotal(o), 0)));
show(servedWithBill.map((o) => `${formatDateTime(o.createdAt)} ${o.status} ${nm(o.customerId)} = ${orderTotal(o)} bills:${(billByOrder.get(o.id) ?? []).map((b) => b.status).join("/")}`));
const multi = orders.filter((o) => (billByOrder.get(o.id) ?? []).filter((b) => b.status !== "cancelled").length > 1);
console.log("orders with MORE THAN ONE live bill (double-billed):", multi.length, "| total", r2(multi.reduce((s, o) => s + orderTotal(o), 0)));
show(multi.map((o) => `${formatDateTime(o.createdAt)} ${nm(o.customerId)} = ${orderTotal(o)} bills:${(billByOrder.get(o.id) ?? []).map((b) => formatDateTime(b.createdAt) + " " + b.status + " due" + b.amountDue).join(" | ")}`));
const emptyOrders = orders.filter((o) => (o.items || []).length === 0);
console.log("orders with no items:", emptyOrders.length);
const itemIds = new Set(menuItems.map((i) => i.id));
const unknownLines = orders.flatMap((o) => (o.items || []).filter((l: any) => !itemIds.has(l.menuItemId)).map((l: any) => ({ at: formatDateTime(o.createdAt), name: l.name, amt: l.qty * l.price })));
console.log("order lines whose menu item no longer exists:", unknownLines.length, "| total", r2(unknownLines.reduce((s, l) => s + l.amt, 0)));
const dupOrders: string[] = [];
const sortedO = [...orders].sort((a, b) => a.createdAt - b.createdAt);
for (let i = 0; i < sortedO.length; i++) for (let j = i + 1; j < sortedO.length; j++) {
  if (sortedO[j].createdAt - sortedO[i].createdAt > 90000) break;
  const a = sortedO[i], b = sortedO[j];
  const sig = (o: any) => o.items.map((l: any) => l.menuItemId + "x" + l.qty).sort().join(",");
  if (a.customerId === b.customerId && sig(a) === sig(b) && sig(a)) dupOrders.push(`${formatDateTime(a.createdAt)} + ${formatDateTime(b.createdAt)} ${nm(a.customerId)} ${a.items.map((l: any) => l.name + "x" + l.qty).join(",")}`);
}
console.log("possible DUPLICATE orders (same person, same items, <90s apart):", dupOrders.length); show(dupOrders);
const aged = orders.filter((o) => o.status !== "billed" && !(billByOrder.get(o.id) ?? []).length && now - o.createdAt > 7 * 86400000);
console.log("served & still unbilled for 7+ days:", aged.length, "| total", r2(aged.reduce((s, o) => s + orderTotal(o), 0)), "| oldest", aged.length ? formatDateTime(Math.min(...aged.map((o) => o.createdAt))) : "-");
const orphanOrders = orders.filter((o) => o.customerId && o.customerId !== "walk-in" && !customers.some((c) => c.id === o.customerId));
console.log("orders for a customer id that no longer exists:", orphanOrders.length, "| total", r2(orphanOrders.reduce((s, o) => s + orderTotal(o), 0)));

H("2. BILLS");
const stat: Record<string, number> = {}; for (const b of bills) stat[b.status] = (stat[b.status] ?? 0) + 1; console.log("status:", JSON.stringify(stat));
const openOld = bills.filter((b) => b.status === "open" && now - b.createdAt > 86400000);
console.log("OPEN (stuck) bills older than 24h:", openOld.length, "| due", r2(openOld.reduce((s, b) => s + b.amountDue, 0)));
show(openOld.map((b) => `${formatDateTime(b.createdAt)} ${b.tableName} ${nm(b.customerId)} due ${b.amountDue} ${b.shares ? "SPLIT" : ""}`));
const mathBad = live.filter((b) => b.status === "paid" && !b.shares && !isCreditSettlement(b) && Math.abs(b.amountCash + b.amountUpi + b.amountDue - b.total) > 0.5);
console.log("paid bills where cash+upi+due != total (written-off / drift):", mathBad.length, "| gap", r2(mathBad.reduce((s, b) => s + (b.total - b.amountCash - b.amountUpi - b.amountDue), 0)));
show(mathBad.map((b) => `${formatDateTime(b.createdAt)} ${b.tableName} ${nm(b.customerId)} total ${b.total} cash ${b.amountCash} upi ${b.amountUpi} due ${b.amountDue}`));
const totalBad = live.filter((b) => !b.shares && !isCreditSettlement(b) && Math.abs(b.tableCharge + b.canteenCharge - b.discount - b.total) > 0.5);
console.log("bills where tableCharge+canteenCharge-discount != total:", totalBad.length); show(totalBad.map((b) => `${formatDateTime(b.createdAt)} ${b.tableName} tc ${b.tableCharge} cc ${b.canteenCharge} disc ${b.discount} total ${b.total}`));
const itemsBad = live.filter((b) => !b.shares && b.canteenItems.length && Math.abs(b.canteenItems.reduce((s: number, i: any) => s + i.price * i.qty, 0) - b.canteenCharge) > 0.5);
console.log("bills where canteen items don't add to canteenCharge:", itemsBad.length); show(itemsBad.map((b) => `${formatDateTime(b.createdAt)} ${b.tableName} items ${b.canteenItems.reduce((s: number, i: any) => s + i.price * i.qty, 0)} vs ${b.canteenCharge}`));
const noCust = live.filter((b) => b.status === "paid" && !b.shares && b.amountDue > 0 && !customers.some((c) => c.id === b.customerId && !c.isWalkIn));
console.log("credit bills with NO real customer profile:", noCust.length, "| due", r2(noCust.reduce((s, b) => s + b.amountDue, 0)));
const future = bills.filter((b) => b.createdAt > now + 3600000);
console.log("bills dated in the future:", future.length);
const splitBad = live.filter((b) => b.shares && Math.abs(b.shares.reduce((s: number, x: any) => s + x.amount, 0) - b.total) > 0.5);
console.log("split bills whose shares don't add to total:", splitBad.length); show(splitBad.map((b) => `${formatDateTime(b.createdAt)} ${b.tableName} shares ${b.shares.reduce((s: number, x: any) => s + x.amount, 0)} vs total ${b.total} status ${b.status}`));
const dupBills: string[] = [];
const sortedB = [...live].sort((a, b) => a.createdAt - b.createdAt);
for (let i = 0; i < sortedB.length; i++) for (let j = i + 1; j < sortedB.length; j++) {
  if (sortedB[j].createdAt - sortedB[i].createdAt > 60000) break;
  const a = sortedB[i], b = sortedB[j];
  if (a.customerId === b.customerId && a.tableId === b.tableId && a.total === b.total && a.total > 0 && !isCreditSettlement(a) && JSON.stringify(a.canteenItems) === JSON.stringify(b.canteenItems) && a.orderId !== b.orderId) dupBills.push(`${formatDateTime(a.createdAt)} + ${formatDateTime(b.createdAt)} ${nm(a.customerId)} ${a.tableName} ${a.total}`);
}
console.log("possible DUPLICATE bills (same person/table/items/total <60s apart, different order):", dupBills.length); show(dupBills);
const dupSettle: string[] = [];
const sett = live.filter((b) => b.status === "paid" && isCreditSettlement(b)).sort((a, b) => a.createdAt - b.createdAt);
for (let i = 0; i < sett.length; i++) for (let j = i + 1; j < sett.length; j++) { if (sett[j].createdAt - sett[i].createdAt > 120000) break; const a = sett[i], b = sett[j]; if (a.customerId === b.customerId && a.amountCash === b.amountCash && a.amountUpi === b.amountUpi && a.discount === b.discount) dupSettle.push(`${formatDateTime(a.createdAt)} ${nm(a.customerId)} ${a.amountCash}/${a.amountUpi}`); }
console.log("possible DUPLICATE settlements:", dupSettle.length); show(dupSettle);
const zeroSettle = sett.filter((b) => b.amountCash + b.amountUpi + b.discount <= 0);
console.log("settlement bills with zero amount:", zeroSettle.length);
const bigSettle = sett.filter((b) => b.amountCash + b.amountUpi > 3000);
console.log("settlements over 3000:", bigSettle.length); show(bigSettle.map((b) => `${formatDateTime(b.createdAt)} ${nm(b.customerId)} ${b.amountCash}/${b.amountUpi}`));

H("3. CUSTOMERS");
const byName = new Map<string, any[]>();
for (const c of customers.filter((x) => !x.isWalkIn)) byName.set(normalizeName(c.name), [...(byName.get(normalizeName(c.name)) ?? []), c]);
const dups = [...byName.entries()].filter(([, v]) => v.length > 1);
console.log("customers sharing the same normalized name:", dups.length); show(dups.map(([k, v]) => `${k}: ${v.length} profiles (${v.map((c: any) => c.id.slice(0, 4)).join(",")})`));
const emptyName = customers.filter((c) => !c.name || !c.name.trim());
console.log("customers with empty name:", emptyName.length, "| walk-in records:", customers.filter((c) => c.isWalkIn).length);
const drift: any[] = [];
for (const rc of rawCust) { const c = customers.find((x) => x.id === rc.id)!; if (c.isWalkIn) continue; const real = creditBalanceFor(live, c.id, normalizeName(c.name)); if (Math.abs(real - Number(rc.credit_balance)) > 0.5) drift.push({ name: c.name, stored: Number(rc.credit_balance), real }); }
console.log("customers whose STORED credit_balance column != real balance:", drift.length, "(app ignores the column; only matters if anything else reads it)"); show(drift, 5);
const noPending = customers.filter((c) => !c.isWalkIn && customerPendingOrders(orders, bills, c.id).length > 0).length;
console.log("customers with served-but-unbilled orders:", noPending);

H("4. MENU / STOCK");
const neg = rawItems.filter((i: any) => i.stock_qty != null && Number(i.stock_qty) < 0);
console.log("items with NEGATIVE stock:", neg.length); show(neg.map((i: any) => `${i.name} ${i.stock_qty}`));
const dupItems = new Map<string, any[]>(); for (const i of rawItems) { const k = i.category_id + "|" + i.name.trim().toLowerCase(); dupItems.set(k, [...(dupItems.get(k) ?? []), i]); }
console.log("items with the same name twice in one category:", [...dupItems.values()].filter((v) => v.length > 1).length);
console.log("items with no cost price:", rawItems.filter((i: any) => i.cost_price == null).length, "of", rawItems.length, "| untracked stock:", rawItems.filter((i: any) => i.stock_qty == null).length);
const lowOut = rawItems.filter((i: any) => i.stock_qty != null && Number(i.stock_qty) <= Number(i.low_stock_threshold ?? 0));
console.log("items at/below low-stock threshold:", lowOut.length); show(lowOut.map((i: any) => `${i.name} ${i.stock_qty}`), 12);
const catIds = new Set(menuCategories.map((c) => c.id));
console.log("items pointing at a missing category:", rawItems.filter((i: any) => !catIds.has(i.category_id)).length);

H("5. TABLES");
for (const t of rawTables) console.log("  ", t.name.padEnd(8), t.status.padEnd(10), t.status === "running" ? "started " + formatDateTime(new Date(t.session_started_at).getTime()) + " cust " + nm(t.customer_id) : "");
const stuck = rawTables.filter((t: any) => t.status === "running" && now - new Date(t.session_started_at).getTime() > 12 * 3600000);
console.log("sessions running 12h+:", stuck.length);

H("6. TIME SANITY");
const paidBefore = rawBills.filter((b: any) => b.paid_at && new Date(b.paid_at).getTime() < new Date(b.created_at).getTime() - 60000);
console.log("bills paid BEFORE they were created:", paidBefore.length);
const byDay = new Map<string, number>(); for (const b of live) byDay.set(toDateInputValue(b.createdAt), (byDay.get(toDateInputValue(b.createdAt)) ?? 0) + 1);
const days = [...byDay.keys()].sort(); console.log("first/last bill day:", days[0], days[days.length - 1], "| days with bills:", days.length);
