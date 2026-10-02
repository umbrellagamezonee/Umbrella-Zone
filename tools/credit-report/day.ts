// One day's report: that day's cash / account / credit, who took credit and
// who paid old credit, and every canteen item category by category.
//   npx tsx day.ts 2026-10-01
// The numbers come from src/lib/dayReport.ts — the same function the app's
// "Din ka Hisaab" screen uses, so the PDF and the app can't differ.
import fs from "fs";
import path from "path";
import { loadAll } from "./load-data";
import { buildDayReport, dayReportSheets } from "../../src/lib/dayReport";
import * as XLSX from "../../node_modules/xlsx";

const date = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) throw new Error("Date do, jaise: npx tsx day.ts 2026-10-01");

const { customers, orders, bills, menuItems, menuCategories, tables, expenses } = loadAll();
const r2 = (n: number) => Math.round(n * 100) / 100;

const report = buildDayReport({ date, bills, orders, expenses, menuItems, menuCategories, tables, customers });
fs.writeFileSync(path.join(__dirname, "data", `day-${date}.json`), JSON.stringify({ ...report, asOf: new Date().toISOString() }, null, 1));

// the Excel is built by the very function the app's Excel button uses
const wb = XLSX.utils.book_new();
for (const sheet of dayReportSheets(report)) {
  const ws = XLSX.utils.json_to_sheet(sheet.rows);
  ws["!cols"] = sheet.widths.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
}
fs.mkdirSync(path.join(__dirname, "out"), { recursive: true });
XLSX.writeFile(wb, path.join(__dirname, "out", `Din-Hisaab-${date}.xlsx`));

// --- checks printed for me ---
const { day, galla, settlements, canteen } = report;
const sumP = (k: "issued" | "settled" | "pending") => r2(day.people.reduce((s, p) => s + p[k], 0));
console.log(report.label, "| Cash", day.cash, "Account", day.upi, "Diya", day.issued, "Settle", day.settled, "Baaki", day.pending);
console.log("people sum: diya", sumP("issued"), "settle", sumP("settled"), "baaki", sumP("pending"), " (n=", day.people.length, ")");
const tot = report.dailyRows.find((r) => r.item === "Total");
console.log("Daily-collection Total row:", tot && { cash: tot.cash, upi: tot.upi, credit: tot.credit });
console.log("galla:", JSON.stringify(galla), "settlements:", settlements.length, "sum cash/upi/disc:", r2(settlements.reduce((s, x) => s + x.cash, 0)), r2(settlements.reduce((s, x) => s + x.upi, 0)), r2(settlements.reduce((s, x) => s + x.disc, 0)));
for (const c of canteen) console.log(c.name.padEnd(10), "sale", c.sale, "qty", c.soldQty, "| billed cash", c.cash, "upi", c.upi, "credit", c.credit, "| notBilled", c.notBilled);
console.log("orders that day:", report.ordersCount, "orphan (deleted menu item) sale:", report.orphanSale);
