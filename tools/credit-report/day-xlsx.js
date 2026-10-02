// One day's Excel. Usage: node day-xlsx.js 2026-10-01   (run `npx tsx day.ts <date>` first)
const XLSX = require("../../node_modules/xlsx");
const fs = require("fs");
const date = process.argv[2];
if (!date) throw new Error("Date do, jaise: node day-xlsx.js 2026-10-01");
const d = JSON.parse(fs.readFileSync(__dirname + `/data/day-${date}.json`, "utf8"));
const r2 = (n) => Math.round(n * 100) / 100;
const tlabel = (t) => new Date(t + 19800000).toISOString().slice(11, 16);
const wb = XLSX.utils.book_new();
const add = (name, rows, widths) => {
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = widths.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
};
const sum = (rows, k) => r2(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0));

const day = d.day;
const g = d.galla;
const exp = d.expenses.reduce((s, e) => s + e.amount, 0);

// 1) Din ka hisaab
const blank = { Cheez: "", Cash: "", Account: "", Rakam: "" };
add("Din ka hisaab", [
  { ...blank, Cheez: "1) US DIN KE BILLS KA HISAAB (baad mein chuka credit usi din mein gina gaya)" },
  { Cheez: "Cash / Account", Cash: day.cash, Account: day.upi, Rakam: r2(day.cash + day.upi) },
  { ...blank, Cheez: "Credit diya", Rakam: day.issued },
  { ...blank, Cheez: "Isme se settle hua (Cash + Account + maaf)", Rakam: day.settled },
  { ...blank, Cheez: "CREDIT BAAKI (diya - settle)", Rakam: day.pending },
  { ...blank },
  { ...blank, Cheez: "2) GALLA - US DIN ASAL MEIN JO PAISA AAYA" },
  { Cheez: "Din ke naye bills", Cash: g.freshCash, Account: g.freshUpi, Rakam: r2(g.freshCash + g.freshUpi) },
  { Cheez: `Purana credit settle (${g.settledCount} logon ne)`, Cash: g.settledCash, Account: g.settledUpi, Rakam: r2(g.settledCash + g.settledUpi) },
  { Cheez: "TOTAL galla", Cash: r2(g.freshCash + g.settledCash), Account: r2(g.freshUpi + g.settledUpi), Rakam: r2(g.freshCash + g.freshUpi + g.settledCash + g.settledUpi) },
  { ...blank, Cheez: "Kharcha (expenses)", Rakam: -exp },
  { ...blank, Cheez: "Kharcha ke baad bacha", Rakam: r2(g.freshCash + g.freshUpi + g.settledCash + g.settledUpi - exp) },
  { ...blank },
  { ...blank, Cheez: "Us din naya credit diya gaya", Rakam: g.creditGiven },
], [70, 14, 14, 14]);

// 2) Table aur Canteen
add("Table aur Canteen", d.dailyRows.filter((r) => r.item !== "").map((r) => ({
  Item: r.item === "Total" ? "TOTAL" : r.item === "Credit settlement" ? "Purane credit / advance (kisi din se match nahi)" : r.item,
  Cash: Number(r.cash) || 0, Account: Number(r.upi) || 0, "Cash + Account": r2((Number(r.cash) || 0) + (Number(r.upi) || 0)), "Credit baaki": Number(r.credit) || 0,
})), [44, 12, 12, 16, 14]);

// 3) Credit (us din ka)
const people = day.people.map((p) => ({ Naam: p.name, "Credit liya": p.issued, "Isme se chuka": p.settled, "Abhi baaki": p.pending }));
people.push({ Naam: "TOTAL", "Credit liya": sum(people, "Credit liya"), "Isme se chuka": sum(people, "Isme se chuka"), "Abhi baaki": sum(people, "Abhi baaki") });
add("Credit (us din ka)", people, [34, 14, 16, 14]);

// 4) Purana credit settle
const settle = d.settlements.map((s) => ({ Time: tlabel(s.t), Naam: s.name, Cash: r2(s.cash), Account: r2(s.upi), "Maaf (discount)": r2(s.disc), "Cash + Account": r2(s.cash + s.upi) }));
settle.push({ Time: "TOTAL", Naam: "", Cash: sum(settle, "Cash"), Account: sum(settle, "Account"), "Maaf (discount)": sum(settle, "Maaf (discount)"), "Cash + Account": sum(settle, "Cash + Account") });
add("Purana credit settle", settle, [8, 30, 10, 10, 16, 14]);

// 5) Canteen ek nazar
const cat = d.canteen.map((c) => ({ Category: c.name, "Kitna bika (qty)": c.soldQty, "Bika (Rs)": c.sale, "Abhi bill nahi hua": c.notBilled, "Bill mein Cash": c.cash, "Bill mein Account": c.upi, "Bill mein Credit baaki": c.credit }));
cat.push({ Category: "TOTAL", "Kitna bika (qty)": sum(cat, "Kitna bika (qty)"), "Bika (Rs)": sum(cat, "Bika (Rs)"), "Abhi bill nahi hua": sum(cat, "Abhi bill nahi hua"), "Bill mein Cash": sum(cat, "Bill mein Cash"), "Bill mein Account": sum(cat, "Bill mein Account"), "Bill mein Credit baaki": sum(cat, "Bill mein Credit baaki") });
add("Canteen ek nazar", cat, [16, 16, 12, 18, 14, 16, 22]);

// 6+) one sheet per category, every item
for (const c of d.canteen) {
  const rows = c.items.map((it) => ({
    Item: it.name,
    Rate: Number(it.price),
    "Kitna bika": it.qty,
    "Bika (Rs)": it.revenue,
    "Abhi stock mein": it.left == null ? "Not tracked" : it.left,
    Profit: it.profit == null || !it.qty ? "-" : it.profit,
  }));
  rows.push({ Item: "TOTAL", Rate: "", "Kitna bika": sum(rows, "Kitna bika"), "Bika (Rs)": sum(rows, "Bika (Rs)"), "Abhi stock mein": "", Profit: sum(rows, "Profit") });
  add(c.name, rows, [34, 10, 12, 12, 16, 12]);
}

fs.mkdirSync(__dirname + "/out", { recursive: true });
XLSX.writeFile(wb, __dirname + `/out/Din-Hisaab-${date}.xlsx`);
console.log("xlsx written", `out/Din-Hisaab-${date}.xlsx`);
