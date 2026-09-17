/**
 * CueBill — Monthly Paid Bills Report
 *
 * SETUP (one time):
 *  1. Open (or create) a Google Sheet.
 *  2. Extensions → Apps Script.
 *  3. Delete whatever is in the editor, paste this whole file.
 *  4. Save (the disk icon / Ctrl+S).
 *  5. In the toolbar dropdown next to "Debug", pick `setupMonthlyTrigger`,
 *     then click ▶ Run once. Google will ask you to authorize — approve it
 *     (it needs permission to edit this sheet and to make web requests).
 *  6. Done. On the 1st of every month at 6 AM IST, a new tab appears in
 *     this sheet with last month's paid bills, totalled at the bottom.
 *
 * To test right now without waiting for the 1st: run `generateMonthlyReport`
 * the same way (pick it in the dropdown, click ▶ Run).
 */

// Same public URL + anon key already used by the live CueBill site — these
// are meant to be public (same ones baked into the deployed app's JS), and
// this project's Row Level Security allows read access with them.
const SUPABASE_URL = "https://qugznkzzzuklxvbqeqzw.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Tbl9LTaV-TujWqH3tkpHqg_HHI_soNg";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30, no DST

// Runs automatically via the trigger set up below. Also safe to run by hand
// any time to test — it always reports the PREVIOUS full calendar month
// (IST), so running it mid-month for testing still shows real data.
function generateMonthlyReport() {
  const now = new Date();
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const year = istNow.getUTCFullYear();
  const month = istNow.getUTCMonth(); // 0-based; this month, so "previous" is month-1

  // First moment of last month and first moment of this month, both in IST,
  // converted back to real UTC instants for the Supabase query.
  const startIst = Date.UTC(year, month - 1, 1, 0, 0, 0);
  const endIst = Date.UTC(year, month, 1, 0, 0, 0);
  const startUtc = new Date(startIst - IST_OFFSET_MS).toISOString();
  const endUtc = new Date(endIst - IST_OFFSET_MS).toISOString();
  const monthLabel = Utilities.formatDate(new Date(startIst), "UTC", "MMM yyyy");

  const bills = fetchSupabase(
    "bills",
    "select=*&created_at=gte." + encodeURIComponent(startUtc) +
      "&created_at=lt." + encodeURIComponent(endUtc) +
      "&amount_paid=gt.0&order=created_at.asc"
  );

  const customers = fetchSupabase("customers", "select=id,name");
  const nameById = {};
  customers.forEach(function (c) { nameById[c.id] = c.name; });

  const rows = [
    ["Date", "Time", "Table / Place", "Customer", "Total", "Amount Paid", "On Credit", "Payment Method"],
  ];
  let sumTotal = 0, sumPaid = 0, sumCredit = 0;
  bills.forEach(function (b) {
    const ist = new Date(new Date(b.created_at).getTime() + IST_OFFSET_MS);
    const total = Number(b.total);
    const paid = Number(b.amount_paid);
    const credit = Number(b.amount_due);
    sumTotal += total;
    sumPaid += paid;
    sumCredit += credit;
    rows.push([
      Utilities.formatDate(ist, "UTC", "dd MMM yyyy"),
      Utilities.formatDate(ist, "UTC", "hh:mm a"),
      b.table_name || "Canteen",
      nameById[b.customer_id] || "Walk-in",
      total,
      paid,
      credit,
      b.payment_method || "",
    ]);
  });
  rows.push(["", "", "", "TOTAL", sumTotal, sumPaid, sumCredit, ""]);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheetName = monthLabel;
  let sheet = ss.getSheetByName(sheetName);
  if (sheet) ss.deleteSheet(sheet); // re-running (e.g. a manual test) replaces it cleanly
  sheet = ss.insertSheet(sheetName);
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sheet.getRange(1, 1, 1, rows[0].length).setFontWeight("bold");
  sheet.getRange(rows.length, 1, 1, rows[0].length).setFontWeight("bold"); // TOTAL row
  sheet.autoResizeColumns(1, rows[0].length);
}

// Run this once from the Apps Script editor to schedule the monthly run —
// see the setup steps at the top of this file.
function setupMonthlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "generateMonthlyReport") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("generateMonthlyReport")
    .timeBased()
    .onMonthDay(1)
    .atHour(6)
    .create();
}

function fetchSupabase(table, query) {
  const url = SUPABASE_URL + "/rest/v1/" + table + "?" + query;
  const res = UrlFetchApp.fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: "Bearer " + SUPABASE_ANON_KEY,
    },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) {
    throw new Error("Supabase request failed: " + res.getContentText());
  }
  return JSON.parse(res.getContentText());
}
