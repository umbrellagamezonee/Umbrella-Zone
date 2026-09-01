export type TableStatus = "available" | "running" | "paused";

export interface BillingTable {
  id: string;
  name: string;
  kind: string; // e.g. "PlayStation", "Pool", "Snooker"
  ratePerHour: number; // default/fallback rate when no game is selected
  defaultSessionMinutes: number; // planned session length, e.g. 60 for 1 hour
  status: TableStatus;
  customerId: string | null; // primary contact for this session (billing/credit)
  extraCustomerIds: string[]; // other people at this table, for record-keeping and split-bill suggestions
  activeGameId: string | null; // game selected for the current session, if any
  sessionRatePerHour: number | null; // rate snapshot for the current session (from the game); null = use ratePerHour
  sessionStartedAt: number | null; // epoch ms, null when not running
  accumulatedMs: number; // time banked from previous run/pause cycles this session
  plannedDurationMs: number | null; // snapshot of defaultSessionMinutes taken at session start
  note: string;
}

export interface Game {
  id: string;
  name: string;
  kind: string; // matches BillingTable.kind, e.g. "PlayStation"
  ratePerHour: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  isWalkIn: boolean;
  creditBalance: number; // positive = customer owes money
  lastReminderAt: number | null;
  createdAt: number;
}

export interface MenuCategory {
  id: string;
  name: string;
}

export interface MenuItem {
  id: string;
  name: string;
  categoryId: string;
  price: number;
  inStock: boolean;
  stockQty: number | null; // null = stock not tracked for this item
  lowStockThreshold: number;
}

export interface OrderLineItem {
  id: string;
  menuItemId: string;
  name: string;
  price: number;
  qty: number;
}

export interface CanteenOrder {
  id: string;
  tableId: string | null;
  customerId: string | null;
  guestName: string | null; // quick name tag for walk-in food orders, no customer profile needed
  items: OrderLineItem[];
  note: string;
  status: "pending" | "served" | "billed";
  createdAt: number;
}

// A snapshot of one food line billed — kept on the Bill itself (not looked up
// from the order) so the receipt still reads correctly even after the order
// is edited or deleted later.
export interface BillCanteenItem {
  name: string;
  price: number;
  qty: number;
}

export type PaymentMethod = "cash" | "upi" | "credit";

// A locked portion of a bill assigned to one payer (e.g. table charge to one
// person, food to another). Once created, a share's label/payer/amount never
// change — only its payment status does.
export interface BillShare {
  id: string;
  label: string;
  payerName: string;
  payerPhone: string;
  amount: number;
  paymentMethod: PaymentMethod | null;
  status: "pending" | "paid";
  paidAt: number | null;
}

export interface Bill {
  id: string;
  tableId: string | null;
  tableName: string | null;
  orderId: string | null; // the canteen order this bill was created from, if any — lets it be found again to resume an unpaid checkout
  gameId: string | null;
  gameName: string | null;
  customerId: string | null;
  tableChargeMinutes: number;
  tableCharge: number;
  canteenCharge: number;
  canteenItems: BillCanteenItem[];
  discount: number;
  total: number;
  amountPaid: number; // actually collected now (cash/UPI)
  amountDue: number; // added to the customer's credit balance
  paymentMethod: PaymentMethod | null; // method used for the amountPaid portion
  shares: BillShare[] | null; // present when the bill was split between payers
  status: "open" | "paid" | "cancelled";
  createdAt: number;
  paidAt: number | null;
  deletedAt: number | null; // set when moved to the trash (Settings → Deleted Bills); null while live
  matchParticipants: string[] | null; // everyone who played this session, snapshotted for history
  matchLoser: string | null; // who lost, if recorded — that's who "Loser pays" billed
}

export interface Expense {
  id: string;
  category: string;
  amount: number;
  note: string;
  createdAt: number;
}

export interface StoreSettings {
  storeName: string;
  currencySymbol: string;
  timezone: string;
  upiId: string;
  appPassword: string; // shared PIN gating access to the whole app on this device
  themeColor: string; // base hex color the primary/accent theme shades are derived from
  themeMode: "dark" | "light";
}
