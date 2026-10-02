import fs from "fs";
import path from "path";

const dir = path.join(__dirname, "data");
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));

export function billFromRow(row: any): any {
  const amountPaid = Number(row.amount_paid);
  const known = row.amount_cash != null && row.amount_upi != null && Math.abs(Number(row.amount_cash) + Number(row.amount_upi) - amountPaid) < 0.01;
  return {
    id: row.id, tableId: row.table_id, tableName: row.table_name, orderId: row.order_id, gameId: row.game_id, gameName: row.game_name, customerId: row.customer_id,
    tableChargeMinutes: Number(row.table_charge_minutes), tableCharge: Number(row.table_charge), canteenCharge: Number(row.canteen_charge), canteenItems: row.canteen_items ?? [],
    discount: Number(row.discount), total: Number(row.total), amountPaid,
    amountCash: known ? Number(row.amount_cash) : row.payment_method === "upi" ? 0 : amountPaid,
    amountUpi: known ? Number(row.amount_upi) : row.payment_method === "upi" ? amountPaid : 0,
    amountDue: Number(row.amount_due), paymentMethod: row.payment_method, shares: row.shares, status: row.status,
    createdAt: new Date(row.created_at).getTime(), paidAt: row.paid_at ? new Date(row.paid_at).getTime() : null,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).getTime() : null, matchParticipants: row.match_participants ?? null, matchLosers: row.match_losers ?? null,
  };
}

export function loadAll() {
  const customers: any[] = read("final_customers.json").map((r: any) => ({ id: r.id, name: r.name, phone: r.phone ?? "", email: r.email, isWalkIn: r.is_walk_in, lastReminderAt: null, createdAt: new Date(r.created_at).getTime() }));
  const orders: any[] = read("final_orders.json").map((r: any) => ({ id: r.id, tableId: r.table_id, customerId: r.customer_id, guestName: r.guest_name, items: r.items ?? [], note: r.note ?? "", status: r.status, createdAt: new Date(r.created_at).getTime() }));
  // the app's store: every non-deleted bill (cancelled ones included)
  const bills: any[] = read("final_bills.json").filter((r: any) => !r.deleted_at).map(billFromRow);
  const menuItems: any[] = read("final_menuitems.json").map((r: any) => ({ id: r.id, categoryId: r.category_id, name: r.name, price: Number(r.price), costPrice: r.cost_price != null ? Number(r.cost_price) : null, stockQty: r.stock_qty != null ? Number(r.stock_qty) : null, lowStockThreshold: Number(r.low_stock_threshold ?? 0) }));
  const expenses: any[] = fs.existsSync(path.join(dir, "final_expenses.json")) ? read("final_expenses.json").map((r: any) => ({ id: r.id, category: r.category, amount: Number(r.amount), note: r.note ?? "", createdAt: new Date(r.created_at).getTime() })) : [];
  const menuCategories: any[] = read("final_menucats.json").map((r: any) => ({ id: r.id, name: r.name }));
  const tables: any[] = read("final_tables.json").map((t: any) => ({ id: t.id, name: t.name }));
  return { customers, orders, bills, menuItems, menuCategories, tables, expenses };
}
