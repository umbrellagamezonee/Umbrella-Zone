// One day's PDF. Usage: node day-pdf.js 2026-10-01   (run `npx tsx day.ts <date>` first)
const PDFDocument = require("pdfkit");
const fs = require("fs");
const date = process.argv[2];
if (!date) throw new Error("Date do, jaise: node day-pdf.js 2026-10-01");
const d = JSON.parse(fs.readFileSync(__dirname + `/data/day-${date}.json`, "utf8"));

const r2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => Number(r2(n)).toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(r2(n)) ? 0 : 2, maximumFractionDigits: 2 });
const money = (n) => (n < 0 ? "-Rs. " : "Rs. ") + fmt(Math.abs(n));
const num = (n) => (n == null ? "-" : Math.abs(n) < 0.005 ? "-" : fmt(n));
const tlabel = (t) => new Date(t + 19800000).toISOString().slice(11, 16);
const asOf = new Date(new Date(d.asOf).getTime() + 19800000);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const asOfText = `${asOf.getUTCDate()} ${MON[asOf.getUTCMonth()]} ${asOf.getUTCFullYear()}, ${asOf.toISOString().slice(11, 16)}`;
const dayTitle = `${Number(date.slice(8, 10))} ${MON[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;

fs.mkdirSync(__dirname + "/out", { recursive: true });
const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36 });
doc.page.margins.bottom = 0;
doc.on("pageAdded", () => (doc.page.margins.bottom = 0));
doc.pipe(fs.createWriteStream(__dirname + `/out/Din-Hisaab-${date}.pdf`));
const L = 36;
const W = 770;
const MAX_Y = 548;

function title(t, sub) {
  doc.font("Helvetica-Bold").fontSize(17).fillColor("#000").text(t, L, 28, { width: W, align: "center" });
  if (sub) doc.font("Helvetica").fontSize(9.5).fillColor("#555").text(sub, L, doc.y + 1, { width: W, align: "center" });
}
function table(cols, rows, y0, o = {}) {
  const rowH = o.rowH || 15;
  const fs_ = o.font || 8;
  const x0 = o.x ?? L;
  const w = cols.reduce((s, c) => s + c.w, 0);
  let y = y0;
  const head = () => {
    doc.rect(x0, y, w, rowH + 3).fill("#2d2d2d");
    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(fs_);
    let x = x0;
    for (const c of cols) { doc.text(c.h, x + 3, y + (rowH + 3 - fs_) / 2 - 1, { width: c.w - 6, align: c.align || "right", lineBreak: false }); x += c.w; }
    y += rowH + 3;
  };
  head();
  rows.forEach((r, i) => {
    if (y + rowH > MAX_Y) { doc.addPage(); y = 36; head(); }
    if (r.bold) doc.rect(x0, y, w, rowH).fill("#d4d4d4");
    else if (i % 2 === 0) doc.rect(x0, y, w, rowH).fill("#f5f5f5");
    doc.fillColor(r.color || "#000").font(r.bold ? "Helvetica-Bold" : "Helvetica").fontSize(fs_);
    let x = x0;
    cols.forEach((c, k) => { doc.text(String(r.cells[k]), x + 3, y + (rowH - fs_) / 2 - 0.5, { width: c.w - 6, align: c.align || "right", lineBreak: false, ellipsis: true }); x += c.w; });
    y += rowH;
  });
  return y;
}
function para(lines, size = 8.6, color = "#333") {
  doc.font("Helvetica").fontSize(size).fillColor(color);
  for (const t of lines) {
    if (doc.y > MAX_Y - 20) { doc.addPage(); doc.y = 36; }
    doc.text("- " + t, L, doc.y + 3, { width: W });
  }
}
// tiles: [{label, value, color, fill, border}], n across, with optional operators between
function tiles(y, items, o = {}) {
  const n = items.length;
  const gap = o.gap ?? 12;
  const bw = (W - gap * (n - 1)) / n;
  const bh = o.h || 54;
  items.forEach((it, i) => {
    const x = L + i * (bw + gap);
    doc.roundedRect(x, y, bw, bh, 6).lineWidth(1.2).fillAndStroke(it.fill || "#f3f3f3", it.border || "#444");
    doc.fillColor("#444").font("Helvetica").fontSize(9).text(it.label, x + 4, y + 8, { width: bw - 8, align: "center", lineBreak: false });
    doc.fillColor(it.color || "#000").font("Helvetica-Bold").fontSize(o.vsize || 17).text(it.value, x + 4, y + 25, { width: bw - 8, align: "center", lineBreak: false });
  });
  return y + bh;
}
function subhead(t, y) {
  doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#000").text(t, L, y);
  return doc.y + 4;
}

const day = d.day;
const g = d.galla;
const exp = d.expenses.reduce((s, e) => s + e.amount, 0);

// ================= PAGE 1: galla + credit =================
title(`${dayTitle} - Din ka hisaab`, `Cash, Account aur Credit (${asOfText} tak ka data)`);
const gc = g.freshCash + g.settledCash;
const gu = g.freshUpi + g.settledUpi;
let y = subhead("1) Us din kitna paisa aaya - Galla (Galla Summary jaisa)", 70);
y = tiles(y + 2, [
  { label: "Cash", value: money(gc), color: "#1b6e2d" },
  { label: "Account", value: money(gu), color: "#1b6e2d" },
  { label: "Kharcha", value: "-" + money(exp), color: "#b00020" },
  { label: "Kharcha ke baad bacha", value: money(gc + gu - exp), fill: "#eef3ff", border: "#2d4a9a" },
], { gap: 10, vsize: 16 });
y = table(
  [{ h: "", w: 330, align: "left" }, { h: "Cash", w: 145 }, { h: "Account", w: 145 }, { h: "Cash + Account", w: 150 }],
  [
    { cells: ["Din ke naye bills", num(g.freshCash), num(g.freshUpi), num(g.freshCash + g.freshUpi)] },
    { cells: [`Purana credit settle (${g.settledCount} logon ne)`, num(g.settledCash), num(g.settledUpi), num(g.settledCash + g.settledUpi)] },
    { bold: true, cells: ["TOTAL galla", fmt(gc), fmt(gu), fmt(gc + gu)] },
    { cells: [`Kharcha (expenses)${d.expenses.length ? ": " + d.expenses.map((e) => `${e.category} ${fmt(e.amount)}`).join(", ") : ""}`, "", "", "-" + fmt(exp)] },
    { bold: true, cells: ["Kharcha ke baad bacha", "", "", fmt(gc + gu - exp)] },
  ],
  y + 8, { rowH: 19, font: 9.3 }
);
doc.y = y + 3;
para([`Galla = us din jo paisa gulle mein aaya, chahe wo kisi bhi din ke credit ka ho (${money(g.settledCash + g.settledUpi)} purane credit ka hai). Ye wahi hai jo Galla Summary mein dikhta hai.`]);

y = subhead(`2) ${dayTitle} ka credit`, doc.y + 12);
y = tiles(y + 2, [
  { label: "Naya credit diya", value: money(day.issued), color: "#9a3b00" },
  { label: "Isme se ab tak chuka", value: money(day.settled), color: "#1b6e2d" },
  { label: "CREDIT BAAKI", value: money(day.pending), color: "#b00020", fill: "#ffecec", border: "#b00020" },
], { gap: 10, vsize: 16 });
doc.font("Helvetica").fontSize(8.6).fillColor("#333").text("Credit diya - chuka = baaki. Jo credit baad mein chuka (cash / account / maaf) wo usi din ke credit mein ginta hai jis din ka wo credit tha. Kisne kitna liya aur kisne purana credit chukaya - aage ke pages par.", L, y + 5, { width: W });

// ================= PAGE 2: bills ka hisaab + table/canteen =================
doc.addPage();
title(`${dayTitle} - Us din ke bills ka hisaab`, "Galla se kaise milta hai, aur Table / Canteen ke hisse mein");
y = table(
  [{ h: "", w: 450, align: "left" }, { h: "Cash", w: 160 }, { h: "Account", w: 160 }],
  [
    { cells: ["Galla - us din asal mein aaya", fmt(day.gallaCash), fmt(day.gallaUpi)] },
    { cells: ["- Us din aaya, par dusre din ke credit ka tha (wahan gina gaya)", "-" + fmt(day.movedOutCash), "-" + fmt(day.movedOutUpi)] },
    { cells: ["+ Dusre din aaya, par is din ke credit ka tha", "+" + fmt(day.movedInCash), "+" + fmt(day.movedInUpi)] },
    { bold: true, cells: ["= Us din ke bills ka hisaab", fmt(day.cash), fmt(day.upi)] },
  ],
  72, { rowH: 20, font: 9.5 }
);
doc.font("Helvetica").fontSize(8.6).fillColor("#333").text("Jo paisa baad mein credit chukane mein aaya wo us din ke hisaab mein gina jaata hai jis din ka wo credit tha - isliye us din ke bills ka Cash/Account galla se alag hota hai. Upar ka milaan dono ko jodta hai.", L, y + 5, { width: W });
const dr = d.dailyRows.filter((r) => r.item !== "");
table(
  [{ h: "Table / Canteen ke hisse mein", w: 170, align: "left" }, { h: "Kul bill", w: 80 }, { h: "Cash", w: 80 }, { h: "Account", w: 80 }, { h: "Cash + Account", w: 95 }, { h: "Credit diya", w: 85 }, { h: "Isme se chuka", w: 90 }, { h: "Credit baaki", w: 90 }],
  dr.map((r) => ({
    bold: r.kind === "subtotal" || r.kind === "total",
    cells: [r.kind === "total" ? "TOTAL" : r.item === "Credit settlement" ? "Purane credit / advance" : r.item, r.kind === "other" ? "-" : num(r.billed), num(r.cash), num(r.upi), num(Number(r.cash) + Number(r.upi)), num(r.issued), num(r.settled), num(r.credit)],
  })),
  doc.y + 14, { rowH: 16, font: 8.6 }
);
doc.y = Math.min(doc.y, MAX_Y - 20);

// ================= PAGE 3: us din ka credit, kisne liya =================
doc.addPage();
title(`${dayTitle} ka credit - kisne liya, kitna chuka, kitna baaki`, "Baaki ke hisaab se upar se neeche");
const people = day.people.map((p) => ({ cells: [p.name, num(p.issued), num(p.settled), num(p.pending)] }));
people.push({ bold: true, cells: ["TOTAL", fmt(day.issued), fmt(day.settled), fmt(day.pending)] });
table([{ h: "Naam", w: 350, align: "left" }, { h: "Credit liya", w: 140 }, { h: "Isme se chuka", w: 140 }, { h: "Abhi baaki", w: 140 }], people, 70, { rowH: 13.5, font: 8.2 });

// ================= PAGE 4: purana credit kisne chukaya =================
doc.addPage();
title(`${dayTitle} ko purana credit kisne chukaya`, `${d.settlements.length} logon ne - Cash ${money(g.settledCash)}, Account ${money(g.settledUpi)}, Maaf ${money(g.forgiven)}`);
if (d.settlements.length === 0) {
  doc.font("Helvetica").fontSize(11).fillColor("#333").text("Is din kisi ne purana credit settle nahi kiya.", L, 80);
} else {
  const colsS = [{ h: "Time", w: 36, align: "left" }, { h: "Naam", w: 170, align: "left" }, { h: "Cash", w: 62 }, { h: "Account", w: 62 }, { h: "Maaf", w: 40 }];
  const blockW = colsS.reduce((s, c) => s + c.w, 0);
  const perCol = 31;
  const list = d.settlements;
  const sheetRows = (chunk) => chunk.map((s) => ({ cells: [tlabel(s.t), s.name, num(s.cash), num(s.upi), num(s.disc)] }));
  for (let i = 0; i < list.length; i += perCol * 2) {
    if (i > 0) { doc.addPage(); title(`${dayTitle} ko purana credit kisne chukaya`, "(aage)"); }
    for (let b = 0; b < 2; b++) {
      const chunk = list.slice(i + b * perCol, i + (b + 1) * perCol);
      if (!chunk.length) continue;
      const x0 = L + b * (blockW + 28);
      const rows = sheetRows(chunk);
      const isLast = i + (b + 1) * perCol >= list.length;
      if (isLast) rows.push({ bold: true, cells: ["", "TOTAL", fmt(g.settledCash), fmt(g.settledUpi), num(g.forgiven)] });
      table(colsS, rows, 70, { rowH: 14.5, font: 8.4, x: x0 });
    }
  }
}

// ================= Canteen =================
doc.addPage();
title(`${dayTitle} - Canteen, category ke hisaab se`, "Kitchen, Cigarettes, Fridge, Chocolate - har category ka alag page aage hai");
const catRows = d.canteen.map((c) => ({ cells: [c.name, c.soldQty, fmt(c.sale), num(c.notBilled), num(c.cash), num(c.upi), num(c.credit)] }));
const sumC = (f) => d.canteen.reduce((s, c) => s + c[f], 0);
catRows.push({ bold: true, cells: ["TOTAL", sumC("soldQty"), fmt(sumC("sale")), fmt(sumC("notBilled")), fmt(sumC("cash")), fmt(sumC("upi")), fmt(sumC("credit"))] });
y = table(
  [{ h: "Category", w: 150, align: "left" }, { h: "Kitna bika (qty)", w: 110 }, { h: "Bika (Rs)", w: 110 }, { h: "Abhi bill nahi hua", w: 120 }, { h: "Bill mein: Cash", w: 100 }, { h: "Account", w: 90 }, { h: "Credit baaki", w: 90 }],
  catRows, 70, { rowH: 22, font: 10 }
);
doc.y = y + 6;
para([
  "'Kitna bika' us din ke orders se hai (menu ke hisaab se, jaise Monthly Report mein). 'Bill mein' Cash / Account / Credit us din ke bills se hai (baad mein chuka credit bhi us din mein gina gaya).",
  "'Abhi bill nahi hua' = us din ke orders jinka bill abhi tak nahi bana. Order ek din ho sakta hai aur bill doosre din (jaise 24 ghante baad apne aap credit mein jaana), isliye 'Bika' aur 'Bill mein' ka total hamesha barabar nahi hota.",
  ...(d.orphanSale > 0 ? [`Menu se hata diye gaye items ka ${money(d.orphanSale)} bika, jo kisi category mein nahi aata.`] : []),
]);

for (const c of d.canteen) {
  doc.addPage();
  title(`${c.name} - ${dayTitle}`, `Is category ke sab items, ek ek karke (bika hua pehle, na bika hua neeche). Profit sirf unka jinka cost price set hai.`);
  let yy = tiles(70, [
    { label: "Kitna bika (qty)", value: String(c.soldQty) },
    { label: "Bika (Rs)", value: money(c.sale), color: "#1b6e2d" },
    { label: "Bill mein Cash", value: money(c.cash) },
    { label: "Account", value: money(c.upi) },
    { label: "Credit baaki", value: money(c.credit), color: "#9a3b00" },
  ], { gap: 10, h: 44, vsize: 14 });
  const rows = c.items.map((it) => ({
    color: it.qty === 0 ? "#777" : undefined,
    cells: [it.name, it.price, it.qty || "-", it.qty ? fmt(it.revenue) : "-", it.left == null ? "-" : it.left, it.profit == null || !it.qty ? "-" : (it.profitPartial ? "~" : "") + fmt(it.profit)],
  }));
  const withProfit = c.items.filter((it) => it.profit != null && it.qty > 0);
  const totProfit = withProfit.reduce((s, it) => s + it.profit, 0);
  rows.push({ bold: true, cells: ["TOTAL", "", c.soldQty, fmt(c.sale), "", withProfit.length ? fmt(totProfit) : "-"] });
  table(
    [{ h: "Item", w: 270, align: "left" }, { h: "Rate", w: 90 }, { h: "Kitna bika", w: 100 }, { h: "Bika (Rs)", w: 110 }, { h: "Abhi stock mein", w: 100 }, { h: "Profit", w: 100 }],
    rows, yy + 10, { rowH: 13.2, font: 8.2 }
  );
}

doc.end();
console.log("pdf written", `out/Din-Hisaab-${date}.pdf`);
