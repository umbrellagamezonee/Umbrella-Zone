// End-to-end check of the new billing: Gaming and Canteen on one bill, paid separately, the Customer
// Bill, credit only for regulars, the ledger / Credits split, and the business-wise reports.
//   node test-billing.js [--exe path\to\CueBill.exe] [--dir work-folder]
// Runs on a scratch data folder (the old data is loaded into it, then three test bills are added).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { harness } = require("./e2e-lib");
const { DataStore } = require("./storage");

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const work = arg("--dir") || path.join(os.tmpdir(), "cuebill-e2e-billing");
fs.rmSync(work, { recursive: true, force: true });
const H = harness({ work, exe: arg("--exe") });
const { check, sleep, clickText, setNumber, text, waitFor, shot, unlock, go, stateOf } = H;

const uuid = () => require("crypto").randomUUID();
const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
// today in the words the screens use ("October 27" / "Oct 27") - the date is never assumed
const todayLong = new Date(today + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
const todayShort = new Date(today + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const daysBackTo21Oct = Math.round((Date.parse(today) - Date.parse("2026-10-21")) / 86400000);

const billButton = `[...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Bill")`;
async function toBillStep(c, label) {
  await waitFor(c, billButton, "Bill button for " + label);
  await sleep(200);
  await clickText(c, "Bill", { exact: true, tag: "button" });
  await waitFor(c, "document.body.innerText.includes('PAYMENT KAISE HUA')", "payment choices for " + label);
  await sleep(300);
}
async function payFromCustomers(c, who) {
  await go(c, "/customers", PIN);
  await waitFor(c, `document.body.innerText.includes(${JSON.stringify(who)})`, who + " in today's list");
  await sleep(400);
  await clickText(c, who, { exact: false, tag: "p" });
  await waitFor(c, "document.body.innerText.includes('Payment: Cash / Account / Credit')", "payment button on " + who);
  await sleep(300);
  await clickText(c, "Payment: Cash / Account / Credit", { exact: false, tag: "button" });
  await waitFor(c, "document.body.innerText.includes('PAYMENT KAISE HUA')", "payment choices for " + who);
  await sleep(300);
}
async function openBill(c, who) {
  await go(c, "/", PIN);
  await waitFor(c, `document.body.innerText.includes(${JSON.stringify(who)})`, who + " on Home");
  await sleep(500);
  await clickText(c, who, { tag: "p" });
  await waitFor(c, billButton, "session screen for " + who);
  await sleep(300);
}
const confirmButton = (c) =>
  c.eval(`(() => { const b = [...document.querySelectorAll("button")].find((x) => /^Confirm/.test(x.textContent.trim())); return b ? { text: b.textContent.trim(), disabled: b.disabled } : null; })()`);
const billOf = (c, id) => c.eval(`${stateOf("cuebill-bills")}.bills.find((b) => b.id === ${JSON.stringify(id)})`);

let PIN = "0000";

(async () => {
  // ---------- set up: load the old data, then add three open test bills ----------
  console.log("== Setup ==");
  H.launch();
  let c = await H.connect();
  PIN = JSON.parse(JSON.parse(fs.readFileSync(path.join(__dirname, "pack-data", "initial-data", "cuebill-data-backup.json"), "utf8"))["cuebill-settings"]).state.appPassword;
  await unlock(c, PIN);
  await sleep(1500);
  c.close();
  H.hardKill();
  await sleep(1500);

  const store = new DataStore(H.DATA);
  const parse = (k) => JSON.parse(store.snapshot()[k]);
  const billsDoc = parse("cuebill-bills");
  const custDoc = parse("cuebill-customers");
  const table = parse("cuebill-tables").state.tables[0];
  const regular = { id: uuid(), name: "Test Regular", phone: "", email: "", isWalkIn: false, lastReminderAt: null, createdAt: Date.now(), isRegular: true };
  const oneTime = { id: uuid(), name: "Test OneTime", phone: "", email: "", isWalkIn: false, lastReminderAt: null, createdAt: Date.now() };
  custDoc.state.customers.push(regular, oneTime);
  const seedBill = (o) => ({
    id: uuid(), tableId: null, tableName: null, orderId: null, gameId: null, gameName: null, customerId: null,
    tableChargeMinutes: 0, tableCharge: 0, canteenCharge: 0, canteenItems: [], discount: 0, total: 0,
    amountPaid: 0, amountCash: 0, amountUpi: 0, amountDue: 0, paymentMethod: null, shares: null, status: "open",
    createdAt: Date.now(), paidAt: null, deletedAt: null, matchParticipants: null, matchLosers: null, ...o,
  });
  const items = [
    { name: "Maggi", price: 50, qty: 1, personName: null },
    { name: "Coke", price: 40, qty: 1, personName: null },
  ];
  const B1 = seedBill({ tableId: table.id, tableName: table.name, tableChargeMinutes: 60, tableCharge: 100, canteenCharge: 90, canteenItems: items, total: 190, amountDue: 190, customerId: regular.id });
  const B2 = seedBill({ tableId: table.id, tableName: table.name, tableChargeMinutes: 30, tableCharge: 60, canteenCharge: 40, canteenItems: [items[1]], total: 100, amountDue: 100, customerId: oneTime.id });
  const O3 = { id: uuid(), tableId: null, customerId: null, guestName: "Walk-in guest", items: [{ id: uuid(), qty: 1, name: "Cold coffee", price: 80, menuItemId: parse("cuebill-menu").state.items[0].id }], note: "", status: "billed", createdAt: Date.now() };
  const B3 = seedBill({ orderId: O3.id, tableName: "Canteen order", canteenCharge: 80, canteenItems: [{ name: "Cold coffee", price: 80, qty: 1, personName: null }], total: 80, amountDue: 80 });
  const share = (label, payerName, amount) => ({ id: uuid(), label, payerName, payerPhone: "", amount, paymentMethod: null, status: "pending", paidAt: null });
  const B4 = seedBill({
    tableId: table.id, tableName: table.name, tableChargeMinutes: 40, tableCharge: 100, canteenCharge: 40, canteenItems: [{ name: "Chips", price: 40, qty: 1, personName: null }], total: 140, amountDue: 140,
    matchParticipants: ["Split A", "Split B"],
    shares: [share("Table charge", "Split A", 50), share("Table charge", "Split B", 50), share("Food", "Split A", 20), share("Food", "Split B", 20)],
  });
  const guy2 = { id: uuid(), name: "Canteen Guy", phone: "", email: "", isWalkIn: false, lastReminderAt: null, createdAt: Date.now(), isRegular: true };
  custDoc.state.customers.push(guy2);
  const O5 = { id: uuid(), tableId: null, customerId: guy2.id, guestName: null, items: [{ id: uuid(), qty: 2, name: "Samosa", price: 15, menuItemId: parse("cuebill-menu").state.items[1].id }], note: "", status: "pending", createdAt: Date.now() };
  const ordersDoc = parse("cuebill-orders");
  ordersDoc.state.orders.unshift(O5);
  ordersDoc.state.orders.unshift(O3);
  billsDoc.state.bills.unshift(B4, B3, B2, B1);
  store.apply({ "cuebill-bills": JSON.stringify(billsDoc), "cuebill-customers": JSON.stringify(custDoc), "cuebill-orders": JSON.stringify(ordersDoc) });
  store.flushNow();
  console.log(`   test bills added: ${B1.total} (regular), ${B2.total} (one-time), ${B3.total} (walk-in canteen)`);

  // ---------- 1. the regular customer's mixed bill ----------
  console.log("\n== 1. Mixed bill, regular customer ==");
  H.launch();
  c = await H.connect();
  await unlock(c, PIN);
  await openBill(c, "Test Regular");
  let t = await text(c);
  check("session screen: when it started, when it ended, how long, Gaming and Canteen, total", /SHURU/.test(t) && /KHATAM/.test(t) && /TIME/.test(t) && /1 ghanta/.test(t) && /Gaming/.test(t) && /Canteen/.test(t) && /Total/.test(t), JSON.stringify(t.slice(-700)));
  check("...and no payment choices yet - just one Bill button", !/PAYMENT KAISE HUA/.test(t) && !/Credit \(baaki\)/.test(t) && !/Sab Cash/.test(t));
  await shot(c, "1-checkout");

  check("the first screen has no payment choices - Bill sends the entry to Customers", !/PAYMENT KAISE HUA/.test(t) && !/Sab Cash/.test(t));
  await clickText(c, "Bill", { exact: true, tag: "button" });
  await waitFor(c, "document.body.innerText.includes('Customers khate mein chali gayi')", "entry sent to Customers");
  t = await text(c);
  check("Bill: the entry went to Test Regular's Customers page (Cash / Account / Credit are chosen there)", /Test Regular ke Customers khate mein chali gayi/.test(t) && /Shuru .* Khatam .* Time 1 ghanta/.test(t), t.slice(0, 500));
  await clickText(c, "Done", { exact: true, tag: "button" });
  await sleep(400);
  const stillOpen = await c.eval(`${stateOf("cuebill-bills")}.bills.find((b) => b.id === ${JSON.stringify(B1.id)}).status`);
  check("until a choice is made the bill is not paid and not credit", stillOpen === "open");
  await payFromCustomers(c, "Test Regular");
  t = await text(c);
  check("Customer Bill screen: start, end, time of the session", /Shuru .* Khatam .* Time 1 ghanta/.test(t), t.slice(0, 600));
  check("Customer Bill screen: three ways to pay - Cash, Account, Credit", /PAYMENT KAISE HUA/.test(t) && (await c.eval(`["Cash","Account","Credit"].every((n) => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === n))`)));
  check("Customer Bill slip: GAMING and CANTEEN sections and the total", /GAMING/.test(t) && /CANTEEN/.test(t) && /Kul bill/.test(t) && /190/.test(t) && /Maggi/.test(t));
  check("Customer Bill slip: gaming 100 and canteen 90 shown apart", /Gaming total\s*₹100/.test(t) && /Canteen total\s*₹90/.test(t), t.slice(-400));
  await shot(c, "2-customer-bill");
  await clickText(c, "PDF / Print", { exact: false, tag: "button" });
  await waitFor(c, "!!document.querySelector('.print-slip')", "full-screen Customer Bill");
  await c.eval(`[...document.querySelectorAll(".print-slip button")].find((b) => /PDF/.test(b.textContent)).click()`);
  await sleep(2500);
  const slipPdf = H.newest(H.DL, ".pdf");
  check("Customer Bill saves as a PDF file", !!slipPdf && fs.statSync(slipPdf).size > 2000, String(slipPdf));
  if (slipPdf) fs.copyFileSync(slipPdf, path.join(H.SHOTS, "customer-bill.pdf"));
  await c.eval(`document.querySelector(".print-slip button[aria-label=Close]")?.click()`);
  await sleep(400);

  // gaming all cash (100), canteen: 40 by account, the other 50 stays credit
  await clickText(c, "Kuch cash, kuch credit? Amount alag-alag daalo", { exact: false, tag: "summary" });
  await sleep(300);
  t = await text(c);
  check("amount boxes (opened on request): Gaming and Canteen each with Cash / Account / Credit", (t.match(/Credit \(baaki\)/g) || []).length === 2);
  await setNumber(c, 0, 100);
  await setNumber(c, 3, 40);
  await sleep(300);
  t = await text(c);
  check("summary: Cash 100, Account 40, Credit 50", /Cash\s*₹100/.test(t) && /Account\s*₹40/.test(t) && /Credit\s*₹50/.test(t), t.slice(-500));
  let btn = await confirmButton(c);
  check("confirm button says how much goes on credit", !!btn && /50 credit mein/.test(btn.text) && !btn.disabled, JSON.stringify(btn));
  await clickText(c, btn.text, { exact: true, tag: "button" });
  await sleep(800);
  t = await text(c);
  check("success screen: gaming and canteen each say how they were paid", /Gaming ₹100:\s*Cash ₹100/.test(t) && /Canteen ₹90:\s*Account ₹40 · Credit ₹50/.test(t), t.slice(0, 400));
  check("success screen: credit went to Test Regular", /added to Test Regular's credit/.test(t));
  let b1 = await billOf(c, B1.id);
  check("saved bill remembers the exact split", JSON.stringify(b1.parts) === JSON.stringify({ gaming: { total: 100, cash: 100, upi: 0, due: 0 }, canteen: { total: 90, cash: 0, upi: 40, due: 50 } }), JSON.stringify(b1 && b1.parts));
  check("saved bill totals: cash 100, account 40, credit 50", b1.amountCash === 100 && b1.amountUpi === 40 && b1.amountDue === 50 && b1.status === "paid");
  await clickText(c, "Customer Bill", { exact: true, tag: "button" });
  await sleep(500);
  t = await text(c);
  check("paid Customer Bill also lists how each business was paid", /PAYMENT/.test(t) && /Gaming\s*Cash ₹100/.test(t) && /Canteen\s*Account ₹40 · Credit ₹50/.test(t), t.slice(-300));
  await c.eval(`document.querySelector(".print-slip button[aria-label=Close]")?.click()`);
  await sleep(300);
  await clickText(c, "Done", { exact: true, tag: "button" });

  // ---------- 2. one-time customer: no credit ----------
  console.log("\n== 2. One-time customer cannot take credit ==");
  await payFromCustomers(c, "Test OneTime");
  btn = await confirmButton(c);
  check("nothing is chosen yet: confirm waits until Cash, Account or Credit is picked", !!btn && btn.disabled, JSON.stringify(btn));
  await clickText(c, "Credit", { exact: true, tag: "button" });
  await sleep(400);
  t = await text(c);
  btn = await confirmButton(c);
  check("one-time customer: credit is blocked with a clear message", /regular customer nahi hai/.test(t) && !!btn && btn.disabled, JSON.stringify(btn));
  await shot(c, "3-not-regular");
  await clickText(c, "Cash", { exact: true, tag: "button" });
  await sleep(300);
  btn = await confirmButton(c);
  check("...but paying in cash works", !!btn && !btn.disabled && /^Confirm payment/.test(btn.text), JSON.stringify(btn));
  await clickText(c, btn.text, { exact: true, tag: "button" });
  await sleep(800);
  const b2 = await billOf(c, B2.id);
  check("one-time bill: gaming 60 cash and canteen 40 cash, no credit", JSON.stringify(b2.parts) === JSON.stringify({ gaming: { total: 60, cash: 60, upi: 0, due: 0 }, canteen: { total: 40, cash: 40, upi: 0, due: 0 } }), JSON.stringify(b2 && b2.parts));
  const stillOneTime = await c.eval(`${stateOf("cuebill-customers")}.customers.find((x) => x.name === "Test OneTime").isRegular === undefined`);
  check("...and the customer stays a one-time customer", stillOneTime);
  await clickText(c, "Done", { exact: true, tag: "button" });

  // ---------- 3. walk-in canteen bill on credit to a regular ----------
  console.log("\n== 3. Walk-in canteen bill, credit to a regular ==");
  await go(c, "/canteen", PIN);
  await waitFor(c, "document.body.innerText.includes('Cold coffee x1')", "walk-in order on the Canteen page");
  await sleep(500);
  await clickText(c, "Cold coffee x1", { tag: "p" });
  await waitFor(c, "document.body.innerText.includes('kis customer ke khate mein')", "asks whose page");
  await H.typeInto(c, 'input[placeholder="Customer ka naam"]', "Test Regular");
  await sleep(300);
  await clickText(c, "Customers mein bhejo", { exact: true, tag: "button" });
  await waitFor(c, "document.body.innerText.includes('Customers khate mein chali gayi')", "walk-in entry sent");
  await clickText(c, "Done", { exact: true, tag: "button" });
  await sleep(400);
  await payFromCustomers(c, "Test Regular");
  await clickText(c, "Credit", { exact: true, tag: "button" });
  await sleep(400);
  btn = await confirmButton(c);
  check("walk-in bill given to Test Regular: Credit is allowed (regular) and says 80", !!btn && !btn.disabled && /80 credit mein/.test(btn.text), JSON.stringify(btn));
  await clickText(c, btn.text, { exact: true, tag: "button" });
  await sleep(800);
  const b3 = await billOf(c, B3.id);
  check("canteen-only bill: all 80 is canteen credit", JSON.stringify(b3.parts) === JSON.stringify({ gaming: { total: 0, cash: 0, upi: 0, due: 0 }, canteen: { total: 80, cash: 0, upi: 0, due: 80 } }) && b3.customerId === regular.id, JSON.stringify(b3 && b3.parts));
  await clickText(c, "Done", { exact: true, tag: "button" });

  // ---------- 4. Credits page and the customer's ledger ----------
  console.log("\n== 4. Credits and ledger ==");
  await go(c, "/credits", PIN);
  t = await text(c);
  const card = await c.eval(`(() => { const p = [...document.querySelectorAll("p")].find((x) => x.textContent.trim() === "Test Regular"); return p ? p.closest("[class*=border]").innerText : null; })()`);
  check("Credits page lists Test Regular with 130 split into Gaming 0 / Canteen 130", !!card && /130/.test(card) && /Gaming\s*₹0/.test(card) && /Canteen\s*₹130/.test(card), String(card));
  check("Credits page has Gaming and Canteen totals", /GAMING KA BAAKI/.test(t) && /CANTEEN KA BAAKI/.test(t));
  check("Credits page has no Remind button, only Settle", !/Remind/.test(t) && /Settle/.test(t));
  await shot(c, "4-credits");

  // paying 60 against the 130 of canteen credit: the oldest credit (the 50) goes first, then 10 of the 80
  await H.typeInto(c, 'input[placeholder="Search name, phone"]', "Test Regular");
  await sleep(500);
  await clickText(c, "Settle", { exact: true, tag: "button" });
  await waitFor(c, "document.body.innerText.includes('Total due')", "Settle screen");
  await sleep(300);
  t = await text(c);
  check("Settle screen: total due 130, split Gaming 0 / Canteen 130", /Total due\s*₹130/.test(t) && /Gaming ka\s*₹0/.test(t) && /Canteen ka\s*₹130/.test(t), t.slice(0, 500));
  await setNumber(c, 1, 60); // 0 = discount, 1 = cash, 2 = account
  await sleep(300);
  await clickText(c, "Settle", { exact: true, tag: "button" });
  await sleep(800);
  t = await text(c);
  check("Settle: says what it cleared (Canteen 60) and what is left (70)", /Isse chuka:\s*Canteen ₹60/.test(t) && /₹70 still due/.test(t), t.slice(0, 500));
  await clickText(c, "Done", { exact: true, tag: "button" });
  await sleep(500);
  await go(c, "/credits", PIN);
  const card2 = await c.eval(`(() => { const p = [...document.querySelectorAll("p")].find((x) => x.textContent.trim() === "Test Regular"); return p ? p.closest("[class*=border]").innerText : null; })()`);
  check("Credits page after settling: Test Regular owes 70, all Canteen", !!card2 && /70/.test(card2) && /Gaming\s*₹0/.test(card2) && /Canteen\s*₹70/.test(card2), String(card2));

  // ---- Customers, day by day: today first, 7 days apart, any other day one at a time ----
  await go(c, "/customers", PIN);
  await waitFor(c, "document.body.innerText.includes('GAMING KA BILL')", "Customers opens on today");
  await sleep(500);
  t = await text(c);
  check("Customers opens on Aaj with today's date", new RegExp("Aaj\\s*—\\s*" + todayLong).test(t), t.slice(0, 300));
  const flat = t.replace(/₹/g, "").replace(/\s+/g, " ");
  check("today: Gaming bill 160, Canteen bill 210, Cash 200, Account 40, Credit liya 130, purana credit chukaya 60",
    /GAMING KA BILL 160/.test(flat) && /CANTEEN KA BILL 210/.test(flat) && /CASH DIYA 200/.test(flat) && /ACCOUNT DIYA 40/.test(flat) && /CREDIT LIYA 130/.test(flat) && /PURANA CREDIT CHUKAYA 60/.test(flat), flat.slice(0, 500));
  const rowReg = await c.eval(`(() => { const p = [...document.querySelectorAll("p")].find((x) => x.textContent.trim().startsWith("Test Regular")); return p ? p.closest("[class*=rounded]").innerText.replace(/\\s+/g, " ") : null; })()`);
  check("today's list: Test Regular - 2 bills, Gaming 100 / Canteen 170, Cash 100, Account 40, credit 130, paid back 60, baaki 70",
    !!rowReg && /2 bill/.test(rowReg) && /Gaming ₹100/.test(rowReg) && /Canteen ₹170/.test(rowReg) && /Cash ₹100/.test(rowReg) && /Account ₹40/.test(rowReg) && /Credit liya ₹130/.test(rowReg) && /chukaya ₹60/.test(rowReg) && /Abhi baaki\s*₹70/.test(rowReg), String(rowReg));
  check("today's list: only people who came today (not the whole directory)", /2 CUSTOMERS/.test(t), t.match(/\d+ CUSTOMERS?/)?.[0] ?? "");
  await shot(c, "4b-customers-today");

  await clickText(c, "7 din", { exact: true, tag: "button" });
  await sleep(700);
  t = await text(c);
  const flat7 = t.replace(/₹/g, "").replace(/\s+/g, " ");
  check("7 din is a separate view: its own heading and a day-by-day table", /Pichhle 7 din/.test(t) && /Din Gaming Canteen Cash Account Credit liya Chukaya/.test(flat7), flat7.slice(0, 400));
  check("7 din: today's row of the table is 160 / 210 / 200 / 40 / 130 / 60", new RegExp(todayShort + " 160 210 200 40 130 60").test(flat7), flat7.slice(0, 700));
  await shot(c, "4c-customers-7days");

  await clickText(c, "Ek din", { exact: true, tag: "button" });
  await sleep(500);
  for (let i = 0; i < daysBackTo21Oct; i++) {
    await c.eval(`document.querySelector('button[aria-label="Pichla din"]').click()`);
    await sleep(150);
  }
  await sleep(700);
  t = await text(c);
  check("Ek din: stepping back to 21 October with the customers of that day", /October 21, 2026/.test(t) && /\d+ CUSTOMERS/.test(t) && !/0 CUSTOMERS/.test(t), t.slice(0, 400));
  await shot(c, "4d-customers-oneday");

  await clickText(c, "Sab customers", { exact: true, tag: "button" });
  await sleep(500);
  t = await text(c);
  check("Sab customers: the whole directory is still there", /Test OneTime/.test(t) && /Test Regular/.test(t) && /Add customer/.test(t));
  await clickText(c, "Aaj", { exact: true, tag: "button" });
  await sleep(300);

  await clickText(c, "Test Regular", { exact: false, tag: "p" });
  await sleep(700);
  t = await text(c);
  check("customer profile: marked Regular, Gaming and Canteen baaki", /Regular customer \(credit milega\)/.test(t) && /Gaming ka baaki/.test(t) && /Canteen ka baaki/.test(t));
  check("profile ledger opens on Aaj, day by day, with each bill's amounts", /Din ke end mein baaki/.test(t) && /Bill: Gaming ₹100 · Canteen ₹90 · Cash ₹100 · Account ₹40/.test(t), t.slice(0, 1200));
  check("ledger lines say Canteen ₹50 and Canteen ₹80, and the payment cleared Canteen ₹60", /Canteen ₹50/.test(t) && /Canteen ₹80/.test(t) && /Chukaya: Canteen ₹60/.test(t) && /Baaki: Canteen ₹70/.test(t), t.slice(0, 900));
  await shot(c, "5-ledger");

  // ---------- 5. reports ----------
  console.log("\n== 5. Reports ==");
  await go(c, "/reports", PIN);
  t = await text(c);
  const box = await c.eval(`(() => { const p = [...document.querySelectorAll("p")].find((x) => x.textContent.trim() === "AAJ"); return p ? p.parentElement.innerText : null; })()`);
  // gaming: cash 160 | canteen: cash 40, account 40, credit 130 | total: cash 200, account 40, credit 130
  const nums = (box || "").replace(/₹/g, "").split(/\s+/);
  check("home: Galla table - Gaming cash 160, Canteen cash 100 (40 + 60 old credit) / account 40; Credit table - Canteen 130", /Gaming\s+160\s+-\s+Canteen\s+100\s+40/.test((box || "").replace(/₹/g, "").replace(/\s+/g, " ")) && /CREDIT[^G]*Gaming\s+-\s+Canteen\s+130/.test((box || "").replace(/₹/g, "").replace(/\s+/g, " ")), String(box));
  check("home: Galla total Cash 260, Account 40; Credit total 130", /Kul\s+260\s+40/.test((box || "").replace(/₹/g, "")) && /Kul\s+130/.test((box || "").replace(/₹/g, "")), nums.join(" "));
  check("home: Cash in drawer counts only cash (260), account shown separately", /₹260/.test(t) && /Account \(₹40 aaj\)/.test(t), t.slice(0, 300));
  check("home: the old mixed 'TOTAL COLLECTED' box is gone", !/TOTAL COLLECTED/.test(t));
  await shot(c, "6-reports");

  await clickText(c, "Din ka Hisaab (PDF jaisa)", { exact: false });
  await waitFor(c, "!!document.querySelector('.hisaab-overlay')", "Hisaab Report open");
  await sleep(1000);
  t = await text(c);
  check("Galla tab: GAMING, CANTEEN and Kul galla - and no credit in it", /1\) GAMING/.test(t) && /2\) CANTEEN/.test(t) && /3\) Kul galla/.test(t) && !/Credit diya/.test(t.slice(0, t.indexOf("Accountant ke liye") > 0 ? t.indexOf("Accountant ke liye") : t.length)), t.slice(0, 900));
  const tiles = await c.eval(`document.querySelector(".hisaab-overlay").innerText`);
  check("day report: Gaming Cash 160, Canteen Account 40", /Cash aaya\s*₹160/.test(tiles) && /Account aaya\s*₹40/.test(tiles), tiles.slice(0, 700));
  check("day report: total galla Cash 260, Account 40", /TOTAL galla\s*260\s*40\s*300/.test(tiles.replace(/₹/g, "")), tiles.replace(/₹/g, "").slice(600, 1500));
  await shot(c, "7-day-report");
  await clickText(c, "Excel", { exact: true, tag: "button" });
  await sleep(3000);
  const dayX = path.join(H.DL, `Galla-Din-${today}.xlsx`);
  const XLSX = require(path.join(__dirname, "..", "node_modules", "xlsx"));
  check("Galla Excel downloaded (Galla-Din-...)", fs.existsSync(dayX));
  if (fs.existsSync(dayX)) {
    const wb = XLSX.readFile(dayX);
    const names = wb.SheetNames;
    check("Galla Excel sheets: Din ka hisaab, Gaming, Canteen, Milaan - and no credit sheet", ["Din ka hisaab", "Gaming (table-wise)", "Canteen (category-wise)", "Milaan (accountant)"].every((n) => names.includes(n)) && !names.some((n) => /^Credit|Purana credit/.test(n)), names.join(" | "));
    const rows = XLSX.utils.sheet_to_json(wb.Sheets["Din ka hisaab"]);
    const total = rows.find((r) => r.Cheez === "TOTAL galla");
    check("day Excel: TOTAL galla Cash 260 / Account 40", !!total && total.Cash === 260 && total.Account === 40, JSON.stringify(total));
    const g = XLSX.utils.sheet_to_json(wb.Sheets["Gaming (table-wise)"]);
    check("Galla Excel: Gaming TOTAL row cash 160, account 0", g[g.length - 1]["Cash aaya"] === 160 && g[g.length - 1]["Account aaya"] === 0 && g[g.length - 1]["Credit diya"] === undefined, JSON.stringify(g[g.length - 1]));
  }
  // the credit of the day, as its own tab and its own file
  await clickText(c, "Credit: ek din (udhaar)", { exact: true, tag: "button" });
  await sleep(1200);
  t = await text(c);
  check("Credit tab: today's credit - Gaming 50 / Canteen 150, where it was given, and no Cash / Account galla in it", /ka credit \(udhaar\)/.test(t) && /Credit kahan se diya gaya/.test(t) && /Naya credit diya/.test(t) && !/3\) Kul galla/.test(t), t.slice(0, 600));
  await clickText(c, "Excel", { exact: true, tag: "button" });
  await sleep(2500);
  const creditX = path.join(H.DL, `Credit-Din-${today}.xlsx`);
  check("Credit Excel downloaded (Credit-Din-...) with only credit sheets", fs.existsSync(creditX) && (() => { const n = XLSX.readFile(creditX).SheetNames; return ["Credit (Gaming-Canteen)", "Credit kahan se", "Credit (us din ka)", "Purana credit settle"].every((x) => n.includes(x)) && !n.includes("Din ka hisaab"); })());
  await clickText(c, "Galla: ek din (Cash + Account)", { exact: true, tag: "button" });
  await sleep(600);
  await clickText(c, "Galla: mahina", { exact: true, tag: "button" });
  await sleep(1500);
  t = await text(c);
  check("month view (Galla): Gaming, Canteen, galla and day-by-day table", /1\) GAMING/.test(t) && /2\) CANTEEN/.test(t) && /Din ke hisaab se/.test(t) && /Gaming Cash/.test(t) && !/Gaming Credit/.test(t));
  await shot(c, "8-month-report");
  await clickText(c, "Excel", { exact: true, tag: "button" });
  await sleep(3000);
  const monthX = path.join(H.DL, `Mahine-Ka-Hisaab-${today.slice(0, 7)}.xlsx`);
  check("month Excel downloaded", fs.existsSync(monthX));
  if (fs.existsSync(monthX)) {
    const wb = XLSX.readFile(monthX);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    const days = rows.filter((r) => r.Din !== "TOTAL");
    const tot = rows.find((r) => r.Din === "TOTAL");
    const sum = (k) => Math.round(days.reduce((s, r) => s + (Number(r[k]) || 0), 0) * 100) / 100;
    check("month Excel: TOTAL row equals the sum of the days (Gaming Cash, Canteen Cash, Canteen Account) - galla only", tot["Gaming Cash"] === sum("Gaming Cash") && tot["Canteen Cash"] === sum("Canteen Cash") && tot["Canteen Account"] === sum("Canteen Account") && tot["Canteen Credit diya"] === undefined, JSON.stringify(tot));
    const last = days[days.length - 1];
    check("month Excel: today's row has Gaming Cash 160, Canteen Cash 100, Canteen Account 40", last["Gaming Cash"] === 160 && last["Canteen Cash"] === 100 && last["Canteen Account"] === 40, JSON.stringify(last));
  }
  await clickText(c, "Customer-wise mahina", { exact: true, tag: "button" });
  await sleep(1500);
  t = await text(c);
  check("customer-wise month: shows Gaming / Canteen split of the credit taken", /Isme Gaming/.test(t) && /Isme Canteen/.test(t) && /Test Regular/.test(t), t.slice(0, 500));
  await clickText(c, "Credit baaki (sab din)", { exact: true, tag: "button" });
  await sleep(2000);
  t = await text(c);
  check("credit tab still works: Kiska credit baaki hai", /Kiska credit baaki hai/.test(t) && /Test Regular/.test(t));
  await c.eval(`document.querySelector(".hisaab-overlay button[aria-label=Close]")?.click()`);

  // ---------- 6. split bill: two people, table + food each ----------
  console.log("\n== 6. Split bill ==");
  await go(c, "/", PIN);
  await waitFor(c, "document.body.innerText.includes('Split A')", "split bill on Home");
  await sleep(500);
  await clickText(c, "Split A", { tag: "p" });
  await waitFor(c, "document.body.innerText.includes('Split bill')", "split checkout open");
  await sleep(400);
  await clickText(c, "Customer Bill (customer ko dikhao)", { exact: false });
  await sleep(500);
  t = await text(c);
  check("split bill: Customer Bill shows Gaming 100 and Canteen 40 and each payer's share", /Gaming total\s*₹100/.test(t) && /Canteen total\s*₹40/.test(t) && /Split A · Table charge/.test(t) && /Kul bill\s*₹140/.test(t), t.slice(-500));
  await c.eval(`document.querySelector(".print-slip button[aria-label=Close]")?.click()`);
  await sleep(300);
  await clickText(c, "Cash", { exact: true, tag: "button" }); // Split A, table charge 50
  await sleep(400);
  await clickText(c, "Credit", { exact: true, tag: "button" }); // Split A, food 20 - A is not a regular
  await sleep(400);
  t = await text(c);
  check("split bill: credit for a one-time payer is stopped with a message", /Split A\s+regular customer nahi hai/.test(t), t.slice(0, 600));
  await clickText(c, "Theek hai", { exact: true, tag: "button" });
  await sleep(300);
  await clickText(c, "Cash", { exact: true, tag: "button" }); // Split A, food 20 in cash
  await sleep(400);
  await clickText(c, "Credit", { exact: true, tag: "button" }); // Split B, table 50 - not a regular yet
  await sleep(400);
  await clickText(c, "Regular banao + credit do", { exact: true, tag: "button" });
  await sleep(500);
  await clickText(c, "Credit", { exact: true, tag: "button" }); // Split B, food 20 - now a regular
  await sleep(600);
  t = await text(c);
  check("split bill: all four shares settled", /All shares settled/.test(t), t.slice(0, 500));
  const b4 = await billOf(c, B4.id);
  const how = (b4.shares || []).map((x) => x.payerName + "/" + x.label + "/" + x.paymentMethod).join(", ");
  check("split bill saved: A paid cash for table and food, B put both on credit", how === "Split A/Table charge/cash, Split B/Table charge/credit, Split A/Food/cash, Split B/Food/credit" && b4.status === "paid", how + " " + b4.status);
  const regs = await c.eval(`(() => { const cs = ${stateOf("cuebill-customers")}.customers; const f = (n) => cs.find((x) => x.name === n); return { a: f("Split A") ? !!f("Split A").isRegular : null, b: f("Split B") ? !!f("Split B").isRegular : null }; })()`);
  check("split bill: Split B became a regular, Split A did not", regs.b === true && regs.a !== true, JSON.stringify(regs));
  await clickText(c, "Done", { exact: true, tag: "button" });
  await go(c, "/credits", PIN);
  await H.typeInto(c, 'input[placeholder="Search name, phone"]', "Split B");
  await sleep(500);
  const card3 = await c.eval(`(() => { const p = [...document.querySelectorAll("p")].find((x) => x.textContent.trim() === "Split B"); return p ? p.closest("[class*=border]").innerText : null; })()`);
  check("Credits page: Split B owes 70 = Gaming 50 + Canteen 20", !!card3 && /Gaming\s*₹50/.test(card3) && /Canteen\s*₹20/.test(card3), String(card3));
  await go(c, "/reports", PIN);
  const box2 = (await c.eval(`(() => { const p = [...document.querySelectorAll("p")].find((x) => x.textContent.trim() === "AAJ"); return p ? p.parentElement.innerText : null; })()`) || "").replace(/₹/g, "");
  // before: Gaming cash 160 | Canteen cash 100, account 40, credit 130.  Split adds: Gaming cash 50, credit 50 | Canteen cash 20, credit 20
  check("Reports: Galla - Gaming cash 210, Canteen cash 120 / account 40, total 330 / 40; Credit - Gaming 50, Canteen 150, total 200", /Gaming\s+210\s+-\s+Canteen\s+120\s+40/.test(box2.replace(/\s+/g, " ")) && /Gaming\s+50\s+Canteen\s+150\s+Kul\s+200/.test(box2.replace(/\s+/g, " ")) && /Kul\s+330\s+40/.test(box2), box2);

  // ---------- 7. the other laptop's data ----------
  console.log("\n== 7. Joining another laptop's data ==");
  // laptop B = the same old data, plus its own new customer, a customer with the same name as one here, bills and a kharcha
  const packed = JSON.parse(fs.readFileSync(path.join(__dirname, "pack-data", "initial-data", "cuebill-data-backup.json"), "utf8"));
  const bState = (k) => JSON.parse(packed[k]);
  const bBills = bState("cuebill-bills");
  const bCust = bState("cuebill-customers");
  const bExp = bState("cuebill-expenses");
  const guy = { id: uuid(), name: "Laptop B Guy", phone: "", email: "", isWalkIn: false, lastReminderAt: null, createdAt: Date.now(), isRegular: true };
  const sameName = { id: uuid(), name: "test regular", phone: "", email: "", isWalkIn: false, lastReminderAt: null, createdAt: Date.now() };
  const lb = (customerId, amount) => seedBill({ status: "paid", customerId, tableName: "Canteen order", canteenCharge: amount, total: amount, amountDue: amount, canteenItems: [{ name: "Chips", price: amount, qty: 1, personName: null }], paidAt: Date.now(),
    parts: { gaming: { total: 0, cash: 0, upi: 0, due: 0 }, canteen: { total: amount, cash: 0, upi: 0, due: amount } } });
  bBills.state.bills.unshift(lb(guy.id, 90), lb(sameName.id, 30));
  bCust.state.customers.push(guy, sameName);
  bExp.state.expenses.push({ id: uuid(), category: "Other", amount: 75, note: "laptop B", createdAt: Date.now() });
  const laptopB = { ...packed, "cuebill-bills": JSON.stringify(bBills), "cuebill-customers": JSON.stringify(bCust), "cuebill-expenses": JSON.stringify(bExp) };
  const laptopBFile = path.join(work, "laptop-B-backup.json");
  fs.writeFileSync(laptopBFile, JSON.stringify(laptopB));
  const billsBefore = await c.eval(`${stateOf("cuebill-bills")}.bills.length`);

  await go(c, "/settings", PIN);
  await clickText(c, "Backup & Restore", { exact: false, tag: "p" });
  await sleep(500);
  const pin2 = await c.eval(`${stateOf("cuebill-settings")}.adminPin`);
  await H.typeInto(c, 'input[placeholder="Admin PIN"]', pin2);
  await H.pressEnter(c);
  await sleep(600);
  t = await text(c);
  check("Backup & Restore has the 'Dusre laptop ka data jodo' part", /Dusre laptop ka data jodo/.test(t));
  const doc = await c.send("DOM.getDocument", {});
  const inputs = await c.send("DOM.querySelectorAll", { nodeId: doc.root.nodeId, selector: "input[type=file]" });
  await c.send("DOM.setFileInputFiles", { nodeId: inputs.nodeIds[1], files: [laptopBFile] });
  await waitFor(c, "document.body.innerText.includes('Dusre laptop ka data jodna hai?')", "merge preview");
  await sleep(300);
  t = await text(c);
  check("preview: 2 new bills, 1 new customer, 1 kharcha, and 1 same-name customer not duplicated", /naye bills\s*2/.test(t) && /naye customers\s*1/.test(t) && /kharche\s*1/.test(t) && /1 customer ka naam bilkul yahi hai/.test(t), t.slice(-700));
  await shot(c, "9-merge-preview");
  await clickText(c, "Jodo", { exact: true, tag: "button" });
  await sleep(2500);
  await unlock(c, PIN);
  const after = await c.eval(`({ bills: ${stateOf("cuebill-bills")}.bills.length, hasGuy: ${stateOf("cuebill-customers")}.customers.some((x) => x.name === "Laptop B Guy"), dup: ${stateOf("cuebill-customers")}.customers.filter((x) => x.name.trim().toLowerCase() === "test regular").length })`);
  check("after joining: 2 more bills, Laptop B Guy is here, still only one 'Test Regular'", after.bills === billsBefore + 2 && after.hasGuy && after.dup === 1, JSON.stringify({ billsBefore, after }));
  check("this laptop's own backup was saved before joining", fs.readdirSync(path.join(H.DATA, "Backups")).some((f) => f.startsWith("cuebill-backup-before-merge-")));
  await go(c, "/credits", PIN);
  await H.typeInto(c, 'input[placeholder="Search name, phone"]', "Laptop B Guy");
  await sleep(500);
  const cardG = await c.eval(`(() => { const p = [...document.querySelectorAll("p")].find((x) => x.textContent.trim() === "Laptop B Guy"); return p ? p.closest("[class*=border]").innerText : null; })()`);
  check("Credits page: Laptop B Guy owes 90, all Canteen", !!cardG && /90/.test(cardG) && /Canteen\s*₹90/.test(cardG), String(cardG));
  await go(c, "/credits", PIN);
  await H.typeInto(c, 'input[placeholder="Search name, phone"]', "Test Regular");
  await sleep(500);
  const cardT = await c.eval(`(() => { const p = [...document.querySelectorAll("p")].find((x) => x.textContent.trim() === "Test Regular"); return p ? p.closest("[class*=border]").innerText : null; })()`);
  check("Credits page: Test Regular now owes 70 + 30 = 100", !!cardT && /100/.test(cardT) && /Canteen\s*₹100/.test(cardT), String(cardT));

  // ---------- 7b. canteen: Bill replaces Served ----------
  console.log("\n== 7b. Canteen: the Bill button ==");
  await go(c, "/canteen", PIN);
  await waitFor(c, "document.body.innerText.includes('Samosa x2')", "pending canteen order");
  await sleep(400);
  t = await text(c);
  check("canteen order card has a Bill button and no Served button", !(await c.eval(`[...document.querySelectorAll("button")].some((b) => /Served/.test(b.textContent))`)) && (await c.eval(`[...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Bill")`)));
  await clickText(c, "Bill", { exact: true, tag: "button" });
  await waitFor(c, "document.body.innerText.includes('Customers khate mein chali gayi')", "canteen bill sent to Customers");
  t = await text(c);
  check("Bill on a canteen order: straight to Canteen Guy's Customers page, nothing paid yet", /Canteen Guy ke Customers khate mein chali gayi/.test(t) && /Samosa/.test(t) && !/PAYMENT KAISE HUA/.test(t), t.slice(0, 400));
  await clickText(c, "Done", { exact: true, tag: "button" });
  const o5 = await c.eval(`(() => { const st = ${stateOf("cuebill-orders")}; const bl = ${stateOf("cuebill-bills")}; const b = bl.bills.find((x) => x.orderId === ${JSON.stringify(O5.id)}); return { order: st.orders.find((o) => o.id === ${JSON.stringify(O5.id)}).status, bill: b && b.status, cust: b && b.customerId }; })()`);
  check("the order is billed, its bill is open and on Canteen Guy", o5.order === "billed" && o5.bill === "open" && o5.cust === guy2.id, JSON.stringify(o5));
  await payFromCustomers(c, "Canteen Guy");
  await clickText(c, "Cash", { exact: true, tag: "button" });
  btn = await confirmButton(c);
  await clickText(c, btn.text, { exact: true, tag: "button" });
  await sleep(800);
  const o5b = await c.eval(`${stateOf("cuebill-bills")}.bills.find((x) => x.orderId === ${JSON.stringify(O5.id)})`);
  check("paid from Customers in cash: canteen cash 30, no credit", o5b.status === "paid" && JSON.stringify(o5b.parts.canteen) === JSON.stringify({ total: 30, cash: 30, upi: 0, due: 0 }), JSON.stringify(o5b && o5b.parts));
  await clickText(c, "Done", { exact: true, tag: "button" });

  // ---------- 8. nothing lost after a hard kill ----------
  console.log("\n== 8. After the app is killed ==");
  await sleep(900);
  c.close();
  H.hardKill();
  await sleep(1500);
  H.launch();
  c = await H.connect();
  await unlock(c, PIN);
  b1 = await billOf(c, B1.id);
  check("the bill's Gaming / Canteen split is still there after a restart", !!b1.parts && b1.parts.canteen.upi === 40 && b1.parts.canteen.due === 50);
  check("no page errors in the whole run", c.errors.length === 0, c.errors.slice(0, 3).join(" | "));
  const outside = c.requests.filter((u) => !/^(app|data|blob|devtools):/.test(u));
  check("nothing went outside the app", outside.length === 0, outside.join(", "));
  c.close();
  H.hardKill();

  console.log(H.failures() === 0 ? "\nALL BILLING CHECKS PASSED" : `\n${H.failures()} CHECK(S) FAILED`);
  console.log("Screenshots and downloads:", work);
  process.exit(H.failures() === 0 ? 0 : 1);
})().catch((e) => {
  console.error("TEST CRASHED:", e);
  H.hardKill();
  process.exit(2);
});
