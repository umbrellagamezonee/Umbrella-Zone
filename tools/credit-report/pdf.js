const PDFDocument = require("pdfkit");
const fs = require("fs");
const d = JSON.parse(fs.readFileSync(__dirname + "/data/credit2.json", "utf8"));
const { h, rep } = d;
const T = h.total;

const r2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => Number(r2(n)).toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(r2(n)) ? 0 : 2, maximumFractionDigits: 2 });
const money = (n) => (n < 0 ? "-Rs. " : "Rs. ") + fmt(Math.abs(n));
const num = (n) => (Math.abs(n) < 0.005 ? "-" : fmt(n));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dlabel = (iso) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}`;
const tlabel = (t) => new Date(t + 19800000).toISOString().slice(11, 16);
const asOf = new Date(new Date(d.asOf).getTime() + 19800000);
const asOfText = `${asOf.getUTCDate()} ${MON[asOf.getUTCMonth()]} ${asOf.getUTCFullYear()}, ${asOf.toISOString().slice(11, 16)}`;

const stamp = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36 });
doc.page.margins.bottom = 0;
doc.on("pageAdded", () => (doc.page.margins.bottom = 0));
doc.pipe(fs.createWriteStream(__dirname + "/out/Credit-Hisaab-" + stamp + ".pdf"));
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
  let y = y0;
  const head = () => {
    doc.rect(L, y, W, rowH + 3).fill("#2d2d2d");
    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(fs_);
    let x = L;
    for (const c of cols) { doc.text(c.h, x + 3, y + (rowH + 3 - fs_) / 2 - 1, { width: c.w - 6, align: c.align || "right", lineBreak: false }); x += c.w; }
    y += rowH + 3;
  };
  head();
  rows.forEach((r, i) => {
    if (y + rowH > MAX_Y) { doc.addPage(); y = 36; head(); }
    if (r.bold) doc.rect(L, y, W, rowH).fill("#d4d4d4");
    else if (r.section) doc.rect(L, y, W, rowH).fill("#fff3cd");
    else if (i % 2 === 0) doc.rect(L, y, W, rowH).fill("#f5f5f5");
    doc.fillColor(r.color || "#000").font(r.bold || r.section ? "Helvetica-Bold" : "Helvetica").fontSize(fs_);
    let x = L;
    cols.forEach((c, k) => { doc.text(String(r.cells[k]), x + 3, y + (rowH - fs_) / 2 - 0.5, { width: c.w - 6, align: c.align || "right", lineBreak: false, ellipsis: true }); x += c.w; });
    y += rowH;
  });
  return y;
}
function para(lines, size = 8.8, color = "#333") {
  doc.font("Helvetica").fontSize(size).fillColor(color);
  for (const t of lines) {
    if (doc.y > MAX_Y - 20) { doc.addPage(); doc.y = 36; }
    doc.text("- " + t, L, doc.y + 3, { width: W });
  }
}
function equationBox(y, items, o = {}) {
  // items: [{label, value, color}] drawn left to right with operators between
  const n = items.length;
  const opW = 36;
  const bw = (W - opW * (n - 1)) / n;
  const bh = o.h || 54;
  items.forEach((it, i) => {
    const x = L + i * (bw + opW);
    doc.roundedRect(x, y, bw, bh, 6).lineWidth(1.2).strokeColor(it.border || "#444").fillAndStroke(it.fill || "#f3f3f3", it.border || "#444");
    doc.fillColor("#444").font("Helvetica").fontSize(9.5).text(it.label, x + 6, y + 8, { width: bw - 12, align: "center", lineBreak: false });
    doc.fillColor(it.color || "#000").font("Helvetica-Bold").fontSize(19).text(it.value, x + 6, y + 24, { width: bw - 12, align: "center", lineBreak: false });
    if (i < n - 1) doc.fillColor("#000").font("Helvetica-Bold").fontSize(22).text(it.op || "", x + bw, y + 14, { width: opW, align: "center", lineBreak: false });
  });
  return y + bh;
}

// ================= PAGE 1: din-wise hisaab =================
title("Credit Hisaab - din ke hisaab se", `Cash, Account aur Credit - 17 Sep se aaj tak (${asOfText} tak ka data)`);
const cols1 = [
  { h: "Din", w: 130, align: "left" },
  { h: "Cash", w: 118 },
  { h: "Account", w: 118 },
  { h: "Credit diya", w: 118 },
  { h: "Credit settle hua", w: 144 },
  { h: "Credit baaki", w: 142 },
];
const rows1 = h.days.map((x) => ({ cells: [x.label, num(x.cash), num(x.upi), num(x.issued), num(x.settled), num(x.pending)] }));
rows1.push({ bold: true, cells: ["TOTAL", fmt(T.cash), fmt(T.upi), fmt(T.issued), fmt(T.settled), fmt(T.pending)] });
let y = table(cols1, rows1, 62, { rowH: 18.5, font: 9.5 });

y = equationBox(y + 12, [
  { label: "Total credit diya", value: money(T.issued), op: "-", color: "#9a3b00" },
  { label: "Total credit settle hua", value: money(T.settled), op: "=", color: "#1b6e2d" },
  { label: "CREDIT BAAKI (abhi pending)", value: money(T.pending), color: "#b00020", fill: "#ffecec", border: "#b00020" },
], { h: 52 });

doc.y = y + 4;
para(
  [
    "Har din ki line mein: Credit diya - Credit settle hua = Credit baaki. Jo credit baad mein chuka (cash ya account se, ya maaf), wo usi din ke hisaab mein gina gaya jis din ka wo credit tha.",
    `Cash aur Account mein wo paisa bhi jud gaya jo baad mein credit chukane mein aaya. Isme Rs. ${fmt(T.untracedCash + T.untracedUpi)} aisa hai jo purane credit / advance ka tha aur kisi din se match nahi hua.`,
  ],
  8.6
);

// ================= PAGE 2+: kiska credit baaki hai =================
doc.addPage();
title("Kiska credit baaki hai", `Sirf wo jinka credit sach mein pending hai - ${asOfText} tak`);
y = equationBox(66, [
  { label: `Customers (${rep.due.filter((r) => r.billed > 0).length} log)`, value: money(rep.owingBilled), op: "+", color: "#000" },
  { label: "Bina profile ke naam", value: money(rep.noProfileTotal), op: "=", color: "#000" },
  { label: "KUL CREDIT BAAKI", value: money(rep.creditBaaki), color: "#b00020", fill: "#ffecec", border: "#b00020" },
], { h: 50 });
doc.font("Helvetica").fontSize(8.6).fillColor("#333").text("Ye wahi number hai jo pehle page pe 'Credit baaki' hai.", L, y + 5, { width: W, align: "center" });

const colsP = [
  { h: "Naam", w: 300, align: "left" },
  { h: "Credit baaki (bill ho chuka)", w: 170 },
  { h: "Serve hue, bill baaki", w: 150 },
  { h: "Total baaki", w: 150 },
];
const rowsP = rep.due.map((x) => ({ cells: [x.name, num(x.billed), num(x.notBilledYet), num(x.total)], color: x.billed < 0 ? "#555" : undefined }));
rowsP.push({ bold: true, cells: ["TOTAL (app ke Credits page jaisa)", fmt(rep.dueBilled), fmt(rep.dueNotBilledYet), fmt(rep.dueTotal)] });
y = table(colsP, rowsP, y + 20, { rowH: 13.5, font: 8.2 });

if (y + 70 > MAX_Y) { doc.addPage(); y = 36; }
doc.font("Helvetica-Bold").fontSize(10).fillColor("#000").text("Bina profile ke baaki - Credits page pe nahi dikhta", L, y + 14);
y = table(
  [{ h: "Naam / pehchaan", w: 470, align: "left" }, { h: "Baaki", w: 300 }],
  [...rep.noProfile.map((x) => ({ cells: [x.name, fmt(x.amount)] })), { bold: true, cells: ["TOTAL", fmt(rep.noProfileTotal)] }],
  doc.y + 6, { rowH: 14, font: 8.4 }
);
if (y + 50 > MAX_Y) { doc.addPage(); y = 36; }
doc.font("Helvetica-Bold").fontSize(10).fillColor("#000").text("Advance - inhone credit se zyada de diya (inka kuch baaki nahi)", L, y + 14);
y = table(
  [{ h: "Naam", w: 470, align: "left" }, { h: "Zyada diya", w: 300 }],
  [...rep.advance.map((x) => ({ cells: [x.name, fmt(x.amount)] })), { bold: true, cells: ["TOTAL", fmt(rep.advanceTotal)] }],
  doc.y + 6, { rowH: 14, font: 8.4 }
);
doc.y = y + 4;
const pairs = [];
for (const n of rep.noProfile) {
  const m = rep.advance.find((x) => Math.abs(x.amount - n.amount) < 0.005 && /Delete hua|profile delete/.test(x.name) && !pairs.some((p) => p.adv === x));
  if (m) pairs.push({ owe: n, adv: m });
}
para(
  [
    "Ye ya to sach mein advance hai, ya settlement galat naam / profile pe chadh gayi.",
    ...(pairs.length
      ? ["Ek baar check kar lena (maine inhe mila nahi diya, sirf rakam barabar dikhi): " + pairs.map((p) => `"${p.owe.name}" ka Rs. ${fmt(p.owe.amount)} baaki hai aur "${p.adv.name}" ne Rs. ${fmt(p.adv.amount)} zyada diya`).join("; ") + "."]
      : []),
  ],
  8.4
);

// hisaab milaan
if (doc.y + 140 > MAX_Y) { doc.addPage(); doc.y = 36; }
doc.font("Helvetica-Bold").fontSize(10).fillColor("#000").text("Hisaab milaan", L, doc.y + 12);
const mil = [
  { cells: ["Customers ka credit baaki (sirf jinka baaki hai)", money(rep.owingBilled)] },
  { cells: ["+ Bina profile ke baaki", money(rep.noProfileTotal)] },
  { bold: true, cells: ["= KUL CREDIT BAAKI (pehle page ke 'Credit baaki' ke barabar)", money(rep.creditBaaki)] },
  { cells: ["App ke Credits page ke total tak: Customers ka credit baaki", money(rep.owingBilled)] },
  { cells: ["+ Serve hue par bill nahi bane (abhi credit nahi bana)", money(rep.dueNotBilledYet)] },
  ...(rep.advanceUsedOnPending > 0.005 ? [{ cells: ["- Advance jo inhi orders mein adjust hua", money(-rep.advanceUsedOnPending)] }] : []),
  { bold: true, cells: ["= App ke Credits page ka total", money(rep.dueTotal)] },
];
y = table([{ h: "", w: 560, align: "left" }, { h: "Rakam", w: 210 }], mil, doc.y + 6, { rowH: 15, font: 8.8 });
if (rep.openSplitCredit > 0.005) {
  doc.y = y + 4;
  para([`Ek split bill abhi open hai, uska Rs. ${fmt(rep.openSplitCredit)} credit hissa tab judega jab wo bill band hoga - upar ke kisi number mein nahi hai.`], 8.4);
}

// ================= Appendix: har customer =================
doc.addPage();
title("Har customer: kitna credit liya, kitna settle kiya, kitna baaki", "Baaki ke hisaab se upar se neeche. Minus = usne zyada de diya (advance).");
const cc = [
  { h: "Naam", w: 330, align: "left" },
  { h: "Credit liya", w: 145 },
  { h: "Settle kiya (Cash+Account+Maaf)", w: 175 },
  { h: "Baaki", w: 120 },
];
const custRows = d.customers.map((c) => ({ cells: [c.name, c.given ? fmt(c.given) : "-", c.settled ? fmt(c.settled) : "-", num(c.balance)] }));
table(cc, custRows, 70, { rowH: 13.5, font: 8 });
doc.font("Helvetica").fontSize(7.8).fillColor("#555").text("Is list mein sirf profile wale customers hain. Kul total pehle page pe hai.", L, doc.y + 6, { width: W });

// ================= Appendix: din-wise settle =================
doc.addPage();
title("Din-ba-din credit settle - cash aur account", "Kis din kitna purana credit chukaya gaya");
const dayRows = d.perDay.map((p) => ({ cells: [dlabel(p.date), p.n, num(p.cash), num(p.upi), num(p.disc), num(p.cash + p.upi)] }));
const sd = (f) => d.perDay.reduce((s, p) => s + p[f], 0);
dayRows.push({ bold: true, cells: ["TOTAL", sd("n"), fmt(sd("cash")), fmt(sd("upi")), fmt(sd("disc")), fmt(sd("cash") + sd("upi"))] });
table(
  [{ h: "Din", w: 130, align: "left" }, { h: "Kitne settle", w: 100 }, { h: "Cash", w: 130 }, { h: "Account", w: 130 }, { h: "Maaf", w: 130 }, { h: "Cash + Account", w: 150 }],
  dayRows, 70, { rowH: 20, font: 9.5 }
);

// ================= Appendix: every settlement =================
doc.addPage();
let first = true;
const colsS = [{ h: "Din / time", w: 62, align: "left" }, { h: "Naam", w: 150, align: "left" }, { h: "Cash", w: 55 }, { h: "Account", w: 55 }, { h: "Maaf", w: 33 }];
const blockW = 360;
const perCol = 52;
const rowHs = 10.2;
const list = d.settlements;
for (let i = 0; i < list.length; i += perCol * 2) {
  if (!first) doc.addPage();
  first = false;
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#000").text("Saari credit settlements, ek ek karke (" + list.length + ")", L, 28, { width: W, align: "center" });
  for (let b = 0; b < 2; b++) {
    const chunk = list.slice(i + b * perCol, i + (b + 1) * perCol);
    if (!chunk.length) continue;
    const x0 = L + b * (blockW + 20);
    let yy = 52;
    doc.rect(x0, yy, blockW, 12).fill("#2d2d2d");
    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(6.8);
    let x = x0;
    for (const c of colsS) { doc.text(c.h, x + 2, yy + 3, { width: c.w - 4, align: c.align || "right", lineBreak: false }); x += c.w; }
    yy += 12;
    chunk.forEach((s, k) => {
      if (k % 2 === 0) doc.rect(x0, yy, blockW, rowHs).fill("#f5f5f5");
      doc.fillColor("#000").font("Helvetica").fontSize(6.8);
      const cells = [dlabel(s.date) + " " + tlabel(s.t), s.name, num(s.cash), num(s.upi), num(s.disc)];
      let xx = x0;
      colsS.forEach((c, q) => { doc.text(cells[q], xx + 2, yy + 2.2, { width: c.w - 4, align: c.align || "right", lineBreak: false, ellipsis: true }); xx += c.w; });
      yy += rowHs;
    });
  }
}

doc.end();
console.log("pdf written");
