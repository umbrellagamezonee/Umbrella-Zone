// Poora purana data ek PDF mein (sirf padhta hai, kuch badalta nahi).
//   npx tsx archive.ts [backup.json] [output.pdf]
// Source: app ka Backup file (Settings -> Backup & Restore wala format).
// Numbers app ke apne functions se aate hain (src/lib/billing.ts, ledger.ts), isliye app se alag nahi honge.
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { creditPendingReport, gallaByDate, billMoney, customerPendingOrders, orderTotal } from "../../src/lib/billing";
import { buildLedger } from "../../src/lib/ledger";
import { normalizeName } from "../../src/lib/customerName";
import { isCreditSettlement, settlementPersonName } from "../../src/lib/billLabel";
import { toDateInputValue } from "../../src/lib/format";

const srcPath = process.argv[2] ?? path.join(__dirname, "../../offline-pack/cuebill-data-backup.json");
const raw = JSON.parse(fs.readFileSync(srcPath, "utf8"));
const st = (k: string) => JSON.parse(raw[k]).state;

const bills: any[] = st("cuebill-bills").bills;
const deletedBills: any[] = st("cuebill-bills").deletedBills ?? [];
const orders: any[] = st("cuebill-orders").orders;
const customers: any[] = st("cuebill-customers").customers;
const menu = st("cuebill-menu");
const expenses: any[] = st("cuebill-expenses").expenses;
const storeName: string = st("cuebill-settings").storeName || "CueBill";
const live = bills.filter((b) => b.status !== "cancelled");

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ist = (t: number) => new Date(t + 19800000);
const dlabel = (t: number) => { const d = ist(t); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`; };
const dkey = (iso: string) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(2, 4)}`;
const tlabel = (t: number) => ist(t).toISOString().slice(11, 16);
const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => Number(r2(n)).toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(r2(n)) ? 0 : 2, maximumFractionDigits: 2 });
const money = (n: number) => (n < 0 ? "-Rs. " : "Rs. ") + fmt(Math.abs(n));
const num = (n: number) => (Math.abs(n) < 0.005 ? "-" : fmt(n));
const ascii = (s: unknown) => String(s ?? "").replace(/[^\x20-\x7e]/g, "?");
const custName = new Map<string, string>(customers.map((c) => [c.id, c.name]));

const times = bills.map((b) => b.createdAt as number);
const firstT = Math.min(...times);
const lastT = Math.max(...times);
const outDir = path.join(__dirname, "../../offline-pack/Purana-Data-PDF");
const stamp = dlabel(lastT).replace(/ /g, "-");
const outPath = process.argv[3] ?? path.join(outDir, `CueBill-Purana-Data-${stamp}.pdf`);
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, bufferPages: true });
doc.page.margins.bottom = 0;
doc.on("pageAdded", () => (doc.page.margins.bottom = 0));
doc.pipe(fs.createWriteStream(outPath));
const L = 36;
const W = 770;
const MAX_Y = 548;
const sections: { name: string; page: number }[] = [];
const pageNo = () => doc.bufferedPageRange().count;

function startSection(name: string, sub?: string) {
  doc.addPage();
  sections.push({ name, page: pageNo() });
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#000").text(name, L, 30, { width: W, align: "center", lineBreak: false });
  if (sub) doc.font("Helvetica").fontSize(9).fillColor("#555").text(sub, L, 50, { width: W, align: "center", lineBreak: false });
  return sub ? 68 : 58;
}

type Col = { h: string; w: number; align?: "left" | "right" | "center" };
type Row = { cells: (string | number)[]; bold?: boolean; section?: boolean; color?: string };
function table(cols: Col[], rows: Row[], y0: number, o: { rowH?: number; font?: number } = {}) {
  const rowH = o.rowH ?? 13;
  const fs_ = o.font ?? 7.5;
  let y = y0;
  const head = () => {
    doc.rect(L, y, W, rowH + 3).fill("#2d2d2d");
    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(fs_);
    let x = L;
    for (const c of cols) { doc.text(c.h, x + 3, y + (rowH + 3 - fs_) / 2 - 1, { width: c.w - 6, align: c.align ?? "right", lineBreak: false }); x += c.w; }
    y += rowH + 3;
  };
  head();
  rows.forEach((r, i) => {
    if (y + rowH > MAX_Y) { doc.addPage(); y = 36; head(); }
    if (r.bold) doc.rect(L, y, W, rowH).fill("#d4d4d4");
    else if (r.section) doc.rect(L, y, W, rowH).fill("#fff3cd");
    else if (i % 2 === 0) doc.rect(L, y, W, rowH).fill("#f5f5f5");
    doc.fillColor(r.color ?? "#000").font(r.bold || r.section ? "Helvetica-Bold" : "Helvetica").fontSize(fs_);
    let x = L;
    cols.forEach((c, k) => { doc.text(String(r.cells[k] ?? ""), x + 3, y + (rowH - fs_) / 2 - 0.5, { width: c.w - 6, align: c.align ?? "right", lineBreak: false, ellipsis: true }); x += c.w; });
    y += rowH;
  });
  return y;
}
function note(text: string, y: number, color = "#555") {
  doc.font("Helvetica").fontSize(8.5).fillColor(color).text(text, L, y, { width: W, lineBreak: false });
}

// ---------------- numbers ----------------
const rep = creditPendingReport(bills, customers, orders);
const galla = gallaByDate(live);
const gallaKeys = [...galla.keys()].sort();
const billCountByDay = new Map<string, number>();
for (const b of live) if (!isCreditSettlement(b)) { const k = toDateInputValue(b.createdAt); billCountByDay.set(k, (billCountByDay.get(k) ?? 0) + 1); }
const saleByDay = new Map<string, number>();
for (const b of live) if (!isCreditSettlement(b)) { const k = toDateInputValue(b.createdAt); saleByDay.set(k, (saleByDay.get(k) ?? 0) + b.total); }
const expByDay = new Map<string, number>();
for (const e of expenses) { const k = toDateInputValue(e.createdAt); expByDay.set(k, (expByDay.get(k) ?? 0) + e.amount); }
const allKeys = [...new Set([...gallaKeys, ...expByDay.keys()])].sort();
const sum = <T,>(a: T[], f: (x: T) => number) => a.reduce((s, x) => s + f(x), 0);
const T = {
  freshCash: sum(gallaKeys, (k) => galla.get(k)!.freshCash), freshUpi: sum(gallaKeys, (k) => galla.get(k)!.freshUpi),
  setCash: sum(gallaKeys, (k) => galla.get(k)!.settledCash), setUpi: sum(gallaKeys, (k) => galla.get(k)!.settledUpi),
  given: sum(gallaKeys, (k) => galla.get(k)!.creditGiven), forgiven: sum(gallaKeys, (k) => galla.get(k)!.forgiven),
  exp: sum(expenses, (e) => e.amount), nBills: sum([...billCountByDay.values()], (x) => x), sale: sum([...saleByDay.values()], (x) => x),
};
const gallaTotal = T.freshCash + T.freshUpi + T.setCash + T.setUpi;

// ---------------- cover ----------------
doc.font("Helvetica-Bold").fontSize(26).fillColor("#000").text(storeName, L, 40, { width: W, align: "center", lineBreak: false });
doc.font("Helvetica-Bold").fontSize(15).text("Purana Data - Poora Record (PDF)", L, 74, { width: W, align: "center", lineBreak: false });
doc.font("Helvetica").fontSize(10).fillColor("#555").text(`Data: ${dlabel(firstT)} se ${dlabel(lastT)} tak  |  Ye PDF sirf record ke liye hai - app ka data alag se Backup file mein bhi hai.`, L, 94, { width: W, align: "center", lineBreak: false });
const sumRows: Row[] = [
  { cells: ["Kul bills (credit settle chhod ke)", fmt(T.nBills)] },
  { cells: ["Cancel kiye bills", fmt(bills.filter((b) => b.status === "cancelled").length)] },
  { cells: ["Delete kiye bills (trash mein)", fmt(deletedBills.length)] },
  { cells: ["Customers", fmt(customers.filter((c) => !c.isWalkIn).length)] },
  { cells: ["Canteen orders", fmt(orders.length)] },
  { cells: ["Galla mein kul aaya (Cash + Account)", money(gallaTotal)], bold: true },
  { cells: ["   Cash", money(T.freshCash + T.setCash)] },
  { cells: ["   Account (UPI)", money(T.freshUpi + T.setUpi)] },
  { cells: ["Credit diya (kul)", money(T.given)] },
  { cells: ["Purana credit wapas aaya (cash + account)", money(T.setCash + T.setUpi)] },
  { cells: ["Credit maaf kiya (discount)", money(T.forgiven)] },
  { cells: ["Credit abhi baaki (kiska kitna - agla section)", money(rep.dueTotal)], bold: true },
  { cells: ["Kharcha (expenses)", money(T.exp)] },
];
table([{ h: "Hisaab", w: 420, align: "left" }, { h: "Kitna", w: 200 }], sumRows, 122, { rowH: 16, font: 9.5 });
const tocY = 122 + 16 * (sumRows.length + 1) + 22;

// ---------------- 1. credit baaki ----------------
{
  let y = startSection("Credit baaki - kiska kitna", `Credits page jaisa hi hisaab | ${dlabel(lastT)} tak`);
  const rows: Row[] = rep.due
    .filter((r) => r.total > 0.004)
    .sort((a, b) => b.total - a.total)
    .map((r, i) => ({ cells: [i + 1, ascii(r.name), ascii(r.phone), num(r.billed), num(r.notBilledYet), fmt(r.total)] }));
  rows.push({ cells: ["", "KUL", "", num(rep.dueBilled), num(rep.dueNotBilledYet), fmt(rep.dueTotal)], bold: true });
  y = table([{ h: "#", w: 36 }, { h: "Naam", w: 290, align: "left" }, { h: "Phone", w: 120, align: "left" }, { h: "Credit (bill ban chuka)", w: 120 }, { h: "Bill banna baaki", w: 100 }, { h: "Kul baaki", w: 104 }], rows, y);
  if (rep.noProfile.length) {
    doc.addPage();
    y = 40;
    note("Ye naam bina customer profile ke hain (profile delete hua / split bill ka payer) - paisa baaki hai:", y, "#000");
    table([{ h: "Naam", w: 520, align: "left" }, { h: "Baaki", w: 250 }], [...rep.noProfile.map((n) => ({ cells: [ascii(n.name), fmt(n.amount)] })), { cells: ["KUL", fmt(rep.noProfileTotal)], bold: true }], y + 14);
  }
  if (rep.advance.length) {
    doc.addPage();
    note("Advance - inhone zyada de diya (ye paisa abhi inke naam jama hai):", 40, "#000");
    table([{ h: "Naam", w: 520, align: "left" }, { h: "Advance", w: 250 }], [...rep.advance.map((n) => ({ cells: [ascii(n.name), fmt(-n.amount)] })), { cells: ["KUL", fmt(rep.advanceTotal)], bold: true }], 54);
  }
}

// ---------------- 2. mahina-wise + din-wise ----------------
{
  let y = startSection("Mahina-wise aur Din-wise hisaab", "Galla = jo paisa us din asal mein aaya (Cash + Account). Purana credit jo us din chuka, wo alag dikhaya hai.");
  const monthly = new Map<string, { n: number; sale: number; cash: number; upi: number; sc: number; su: number; given: number; exp: number }>();
  for (const k of allKeys) {
    const m = k.slice(0, 7);
    const g = galla.get(k);
    const a = monthly.get(m) ?? { n: 0, sale: 0, cash: 0, upi: 0, sc: 0, su: 0, given: 0, exp: 0 };
    a.n += billCountByDay.get(k) ?? 0; a.sale += saleByDay.get(k) ?? 0; a.exp += expByDay.get(k) ?? 0;
    if (g) { a.cash += g.freshCash; a.upi += g.freshUpi; a.sc += g.settledCash; a.su += g.settledUpi; a.given += g.creditGiven; }
    monthly.set(m, a);
  }
  const mrows: Row[] = [...monthly.entries()].sort().map(([m, a]) => ({ cells: [`${MON[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`, fmt(a.n), fmt(a.sale), num(a.cash), num(a.upi), num(a.sc), num(a.su), num(a.given), fmt(a.cash + a.upi + a.sc + a.su), num(a.exp)] }));
  const cols: Col[] = [{ h: "Din", w: 70, align: "left" }, { h: "Bills", w: 40 }, { h: "Kul bika", w: 78 }, { h: "Aaya Cash", w: 76 }, { h: "Aaya Account", w: 76 }, { h: "Purana credit Cash", w: 84 }, { h: "Purana credit Acc.", w: 84 }, { h: "Credit diya", w: 76 }, { h: "Kul galla", w: 90 }, { h: "Kharcha", w: 96 }];
  mrows.push({ cells: ["KUL", fmt(T.nBills), fmt(T.sale), num(T.freshCash), num(T.freshUpi), num(T.setCash), num(T.setUpi), num(T.given), fmt(gallaTotal), num(T.exp)], bold: true });
  y = table(cols, mrows, y, { rowH: 15, font: 8.5 });
  note("Kul galla = Aaya Cash + Aaya Account + Purana credit (Cash + Account). Kul bika = bills ka total (udhaar bhi). Credit diya galla mein nahi gina jaata (wo udhaar hai).", y + 8);
  doc.addPage();
  const drows: Row[] = allKeys.map((k) => {
    const g = galla.get(k);
    const fc = g?.freshCash ?? 0, fu = g?.freshUpi ?? 0, sc = g?.settledCash ?? 0, su = g?.settledUpi ?? 0;
    return { cells: [dkey(k), billCountByDay.get(k) ?? 0, num(saleByDay.get(k) ?? 0), num(fc), num(fu), num(sc), num(su), num(g?.creditGiven ?? 0), fmt(fc + fu + sc + su), num(expByDay.get(k) ?? 0)] };
  });
  drows.push({ cells: ["KUL", fmt(T.nBills), fmt(T.sale), num(T.freshCash), num(T.freshUpi), num(T.setCash), num(T.setUpi), num(T.given), fmt(gallaTotal), num(T.exp)], bold: true });
  note("Din-wise (har din ka alag)", 30, "#000");
  table(cols, drows, 44, { rowH: Math.min(13.5, (MAX_Y - 44 - 16) / (drows.length + 0.5)), font: 8 });
}

// ---------------- 3. customer-wise credit khata ----------------
{
  let y = startSection("Customer-wise credit khata", "Har customer ka poora credit hisaab: kab kitna credit diya (Diya), kab kitna chuka (Jama), aur baaki");
  const pendingByCust = new Map<string, any[]>();
  const blocks: { c: any; entries: any[] }[] = [];
  for (const c of customers) {
    if (c.isWalkIn) continue;
    const nameKey = normalizeName(c.name);
    const mine = bills.filter((b) => (b.shares ? b.shares.some((s: any) => normalizeName(s.payerName) === nameKey) : b.customerId === c.id));
    const pending = customerPendingOrders(orders, bills, c.id);
    pendingByCust.set(c.id, pending);
    if (mine.length === 0 && pending.length === 0) continue;
    const entries = buildLedger(mine, pending, nameKey, orders).filter((e) => !e.paidNow && (e.debit > 0.004 || e.credit > 0.004));
    if (entries.length) blocks.push({ c, entries });
  }
  blocks.sort((a, b) => a.c.name.localeCompare(b.c.name));
  const cols: Col[] = [{ h: "Tareekh", w: 70, align: "left" }, { h: "Kya", w: 430, align: "left" }, { h: "Diya", w: 90 }, { h: "Jama", w: 90 }, { h: "Baaki", w: 90 }];
  y = startNewBlockPage();
  function startNewBlockPage() { return 64; }
  for (const { c, entries } of blocks) {
    const last = entries[entries.length - 1];
    if (y + 15 + 13 * 3 > MAX_Y) { doc.addPage(); y = 36; }
    doc.rect(L, y, W, 15).fill("#fff3cd");
    doc.fillColor("#000").font("Helvetica-Bold").fontSize(9).text(`${ascii(c.name)}${c.phone ? "   (" + ascii(c.phone) + ")" : ""}`, L + 4, y + 3.5, { width: 520, lineBreak: false, ellipsis: true });
    doc.text(`Baaki: ${fmt(last.balanceAfter)}`, L + 560, y + 3.5, { width: 206, align: "right", lineBreak: false });
    y += 15;
    for (const e of entries) {
      if (y + 13 > MAX_Y) { doc.addPage(); y = 36; }
      doc.fillColor("#000").font("Helvetica").fontSize(7.5);
      doc.text(dlabel(e.date), L + 3, y + 2.5, { width: 64, lineBreak: false });
      doc.text(ascii(e.particulars) + (e.orderedNote ? `  (${ascii(e.orderedNote)})` : "") + (e.order ? "  [bill banna baaki]" : ""), L + 73, y + 2.5, { width: 424, lineBreak: false, ellipsis: true });
      doc.text(num(e.debit), L + 500, y + 2.5, { width: 84, align: "right", lineBreak: false });
      doc.text(num(e.credit), L + 590, y + 2.5, { width: 84, align: "right", lineBreak: false });
      doc.text(fmt(e.balanceAfter), L + 680, y + 2.5, { width: 84, align: "right", lineBreak: false });
      doc.moveTo(L, y + 13).lineTo(L + W, y + 13).lineWidth(0.3).strokeColor("#ccc").stroke();
      y += 13;
    }
    y += 8;
  }
  void cols;
}

// ---------------- 4. saare bills ----------------
{
  const y = startSection("Saare bills (tareekh ke hisaab se)", `${bills.length} bills | credit settlement bhi isme hain`);
  const sorted = [...bills].sort((a, b) => a.createdAt - b.createdAt);
  const rows: Row[] = sorted.map((b, i) => {
    const m = billMoney(b);
    const who = isCreditSettlement(b) ? `Credit settle - ${ascii(settlementPersonName(b, customers.find((c) => c.id === b.customerId)))}` : b.tableId ? `${ascii(b.tableName)}${b.customerId && custName.get(b.customerId) ? " - " + ascii(custName.get(b.customerId)) : ""}` : ascii(custName.get(b.customerId) ?? b.tableName ?? "Canteen");
    const parts: string[] = [];
    if (b.tableId && b.tableChargeMinutes > 0) parts.push(`${b.gameName ? ascii(b.gameName) + " " : ""}${Math.round(b.tableChargeMinutes)} min`);
    for (const it of b.canteenItems ?? []) parts.push(it.qty > 1 ? `${ascii(it.name)} x${it.qty}` : ascii(it.name));
    if (b.discount > 0) parts.push(`(discount ${fmt(b.discount)})`);
    return { cells: [i + 1, dlabel(b.createdAt), tlabel(b.createdAt), who, isCreditSettlement(b) ? "" : parts.join(", "), fmt(b.total), num(m.cash), num(m.upi), num(m.credit), b.status === "cancelled" ? "CANCEL" : b.status === "open" ? "OPEN" : ""], color: b.status === "cancelled" ? "#a00" : undefined };
  });
  table([{ h: "#", w: 32 }, { h: "Din", w: 52, align: "left" }, { h: "Time", w: 34, align: "left" }, { h: "Table / Customer", w: 150, align: "left" }, { h: "Kya tha", w: 260, align: "left" }, { h: "Total", w: 46 }, { h: "Cash", w: 44 }, { h: "Acc.", w: 44 }, { h: "Credit", w: 44 }, { h: "", w: 64, align: "left" }], rows, y, { rowH: 12, font: 6.8 });
}

// ---------------- 5. bill nahi bane orders ----------------
{
  let y = startSection("Canteen orders - bill banna baaki", "Khana de diya gaya, par abhi tak bill nahi bana (ye bhi credit baaki mein gine jaate hain)");
  const billed = new Set(live.map((b) => b.orderId).filter(Boolean));
  const open = orders.filter((o) => o.status !== "billed" && !billed.has(o.id) && o.items.length > 0).sort((a, b) => a.createdAt - b.createdAt);
  const rows: Row[] = open.map((o, i) => ({ cells: [i + 1, dlabel(o.createdAt), ascii(custName.get(o.customerId) ?? o.guestName ?? "-"), o.items.map((x: any) => (x.qty > 1 ? `${ascii(x.name)} x${x.qty}` : ascii(x.name))).join(", "), fmt(orderTotal(o)), o.status] }));
  rows.push({ cells: ["", "", "KUL", "", fmt(sum(open, (o) => orderTotal(o))), ""], bold: true });
  y = table([{ h: "#", w: 36 }, { h: "Din", w: 60, align: "left" }, { h: "Customer", w: 150, align: "left" }, { h: "Kya tha", w: 400, align: "left" }, { h: "Amount", w: 70 }, { h: "Status", w: 54, align: "left" }], rows, y, { rowH: 12, font: 7 });
}

// ---------------- 6. kharcha ----------------
{
  const y = startSection("Kharcha (expenses)", `${expenses.length} entries | kul ${money(T.exp)}`);
  const rows: Row[] = [...expenses].sort((a, b) => a.createdAt - b.createdAt).map((e, i) => ({ cells: [i + 1, dlabel(e.createdAt), ascii(e.category), ascii(e.note), fmt(e.amount)] }));
  rows.push({ cells: ["", "", "KUL", "", fmt(T.exp)], bold: true });
  table([{ h: "#", w: 36 }, { h: "Din", w: 70, align: "left" }, { h: "Category", w: 150, align: "left" }, { h: "Note", w: 420, align: "left" }, { h: "Amount", w: 94 }], rows, y, { rowH: 14, font: 8 });
}

// ---------------- 7. menu ----------------
{
  const y = startSection("Menu aur stock", `${menu.items.length} items`);
  const cat = new Map<string, string>(menu.categories.map((c: any) => [c.id, c.name]));
  const rows: Row[] = [...menu.items].sort((a: any, b: any) => String(cat.get(a.categoryId)).localeCompare(String(cat.get(b.categoryId))) || a.name.localeCompare(b.name)).map((it: any, i: number) => ({ cells: [i + 1, ascii(cat.get(it.categoryId) ?? ""), ascii(it.name), fmt(it.price), it.costPrice != null ? fmt(it.costPrice) : "-", it.stockQty != null ? fmt(it.stockQty) : "-"] }));
  table([{ h: "#", w: 36 }, { h: "Category", w: 170, align: "left" }, { h: "Item", w: 320, align: "left" }, { h: "Bechne ka", w: 80 }, { h: "Kharid", w: 80 }, { h: "Stock", w: 84 }], rows, y, { rowH: 13, font: 8 });
}

// ---------------- 8. customers ----------------
{
  const y = startSection("Saare customers", `${customers.filter((c) => !c.isWalkIn).length} customers (naam aur phone)`);
  const list = customers.filter((c) => !c.isWalkIn).sort((a, b) => a.name.localeCompare(b.name));
  const rows: Row[] = list.map((c, i) => ({ cells: [i + 1, ascii(c.name), ascii(c.phone)] }));
  table([{ h: "#", w: 40 }, { h: "Naam", w: 400, align: "left" }, { h: "Phone", w: 330, align: "left" }], rows, y, { rowH: 13, font: 8 });
}

// ---------------- 9. deleted bills ----------------
if (deletedBills.length) {
  const y = startSection("Delete kiye gaye bills (trash)", `${deletedBills.length} bills - app ke Settings -> Deleted Bills mein bhi hain`);
  const rows: Row[] = [...deletedBills].sort((a, b) => a.createdAt - b.createdAt).map((b, i) => ({ cells: [i + 1, dlabel(b.createdAt), tlabel(b.createdAt), ascii(b.tableName ?? ""), ascii(custName.get(b.customerId) ?? ""), fmt(b.total), b.deletedAt ? dlabel(b.deletedAt) : ""] }));
  table([{ h: "#", w: 36 }, { h: "Din", w: 60, align: "left" }, { h: "Time", w: 40, align: "left" }, { h: "Table", w: 200, align: "left" }, { h: "Customer", w: 250, align: "left" }, { h: "Total", w: 80 }, { h: "Delete hua", w: 104, align: "left" }], rows, y, { rowH: 12, font: 7 });
}

// ---------------- contents + page numbers ----------------
const total = doc.bufferedPageRange().count;
doc.switchToPage(0);
doc.font("Helvetica-Bold").fontSize(11).fillColor("#000").text("Is PDF mein kya hai", L, tocY, { width: W, lineBreak: false });
sections.forEach((s, i) => {
  doc.font("Helvetica").fontSize(9.5).fillColor("#222").text(`${i + 1}.  ${s.name}`, L + 8, tocY + 18 + i * 14, { width: 500, lineBreak: false });
  doc.text(`page ${s.page}`, L + 520, tocY + 18 + i * 14, { width: 100, align: "right", lineBreak: false });
});
for (let i = 0; i < total; i++) {
  doc.switchToPage(i);
  doc.font("Helvetica").fontSize(7.5).fillColor("#777").text(`${ascii(storeName)} - Purana Data (${dlabel(lastT)} tak)   |   page ${i + 1} / ${total}`, L, 570, { width: W, align: "center", lineBreak: false });
}
doc.end();
doc.on("end", () => undefined);
process.on("exit", () => console.log(`PDF: ${outPath}  (${total} pages)`));
