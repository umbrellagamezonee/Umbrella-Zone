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
  sortOrder: number; // manual display order for Home + Table Management; per-device, not cloud-synced
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
  price: number; // selling price
  costPrice: number | null; // what it costs to buy/make one unit; null = not entered
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
  // Who at the table this was ordered for — only meaningful when a table has
  // multiple people, so the bill/receipt can show who had what.
  personName?: string | null;
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
  personName?: string | null;
}

// "upi" covers any bank/account transfer, not just a UPI-app payment — the
// shop just calls it "Account". "split" means the amountPaid portion below
// was itself divided between cash and account (see amountCash/amountUpi).
export type PaymentMethod = "cash" | "upi" | "credit" | "split";

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
  amountPaid: number; // actually collected now — amountCash + amountUpi
  amountCash: number; // portion of amountPaid received as cash
  amountUpi: number; // portion of amountPaid received via account/UPI transfer
  amountDue: number; // added to the customer's credit balance
  paymentMethod: PaymentMethod | null; // best-effort label for the amountPaid portion — "split" when both amountCash and amountUpi are non-zero
  shares: BillShare[] | null; // present when the bill was split between payers
  status: "open" | "paid" | "cancelled";
  createdAt: number;
  paidAt: number | null;
  deletedAt: number | null; // set when moved to the trash (Settings → Deleted Bills); null while live
  matchParticipants: string[] | null; // everyone who played this session, snapshotted for history
  matchLosers: string[] | null; // whoever lost, if recorded — split equally when there's more than one
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
  adminPin: string; // second PIN gating Menu Management / Deleted Bills / Backup & Restore — staff who know appPassword can't reach these without it
  themeColor: string; // base hex color the primary/accent theme shades are derived from
  themeMode: "dark" | "light";
}
