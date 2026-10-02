const XLSX = require("../../node_modules/xlsx");
const d = require("./data/credit2.json");
const r2 = (n) => Math.round(n * 100) / 100;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dlabel = (iso) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}`;
const tlabel = (t) => new Date(t + 19800000).toISOString().slice(11, 16);
const wb = XLSX.utils.book_new();
const add = (name, rows, widths) => {
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = widths.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, name);
};
// first two: exactly what the app's Excel export writes
add("Credit hisaab", d.hisaabSheet, [44, 12, 12, 13, 17, 13]);
add("Credit baaki - kiska", d.pendingSheet, [56, 26, 20, 14]);

add("Har customer", d.customers.map((c) => ({ Naam: c.name, "Credit liya": r2(c.given), "Settle kiya (Cash+Account+Maaf)": r2(c.settled), Baaki: r2(c.balance) })), [34, 14, 30, 12]);

const settle = d.settlements.map((s) => ({ Din: dlabel(s.date), Time: tlabel(s.t), Naam: s.name, Cash: r2(s.cash), Account: r2(s.upi), "Maaf (discount)": r2(s.disc), "Cash + Account": r2(s.cash + s.upi) }));
const sm = (rows, k) => r2(rows.reduce((a, r) => a + r[k], 0));
settle.push({ Din: "TOTAL", Time: "", Naam: "", Cash: sm(settle, "Cash"), Account: sm(settle, "Account"), "Maaf (discount)": sm(settle, "Maaf (discount)"), "Cash + Account": sm(settle, "Cash + Account") });
add("Settlements", settle, [10, 8, 30, 10, 10, 15, 14]);

const perDay = d.perDay.map((p) => ({ Din: dlabel(p.date), "Kitne settle": p.n, Cash: p.cash, Account: p.upi, "Maaf (discount)": p.disc, "Cash + Account": r2(p.cash + p.upi) }));
perDay.push({ Din: "TOTAL", "Kitne settle": sm(perDay, "Kitne settle"), Cash: sm(perDay, "Cash"), Account: sm(perDay, "Account"), "Maaf (discount)": sm(perDay, "Maaf (discount)"), "Cash + Account": sm(perDay, "Cash + Account") });
add("Din ba din settle", perDay, [10, 14, 12, 12, 15, 16]);

const stamp = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
XLSX.writeFile(wb, __dirname + "/out/Credit-Hisaab-" + stamp + ".xlsx");
console.log("xlsx written; settlement total:", settle[settle.length - 1]);
