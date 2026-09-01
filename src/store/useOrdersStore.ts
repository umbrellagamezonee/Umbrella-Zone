import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CanteenOrder, OrderLineItem } from "../types";
import { useMenuStore } from "./useMenuStore";
import { setupSync, pushInsert, pushUpsert, pushDeleteAll } from "../lib/cloudSync";

interface OrderRow {
  id: string;
  table_id: string | null;
  customer_id: string | null;
  guest_name: string | null;
  items: OrderLineItem[];
  note: string;
  status: string;
  created_at: string;
}

const TABLE = "canteen_orders";
const fromRow = (row: OrderRow): CanteenOrder => ({
  id: row.id,
  tableId: row.table_id,
  customerId: row.customer_id,
  guestName: row.guest_name,
  items: row.items ?? [],
  note: row.note ?? "",
  status: row.status as CanteenOrder["status"],
  createdAt: new Date(row.created_at).getTime(),
});
const toRow = (o: CanteenOrder): OrderRow => ({
  id: o.id,
  table_id: o.tableId,
  customer_id: o.customerId,
  guest_name: o.guestName,
  items: o.items,
  note: o.note,
  status: o.status,
  created_at: new Date(o.createdAt).toISOString(),
});

function pushOrder(id: string) {
  const o = useOrdersStore.getState().orders.find((x) => x.id === id);
  if (o) pushUpsert(TABLE, toRow(o));
}

interface OrdersState {
  orders: CanteenOrder[];
  createOrder: (tableId: string | null, customerId: string | null, guestName?: string | null) => CanteenOrder;
  getOpenOrderForTable: (tableId: string) => CanteenOrder | undefined;
  addItem: (orderId: string, item: Omit<OrderLineItem, "id">) => void;
  changeQty: (orderId: string, lineItemId: string, qty: number) => void;
  removeItem: (orderId: string, lineItemId: string) => void;
  setNote: (orderId: string, note: string) => void;
  markServed: (orderId: string) => void;
  markBilled: (orderId: string) => void;
  unmarkBilled: (orderId: string) => void;
  reassignToTable: (orderId: string, tableId: string, customerId: string | null) => void;
  orderTotal: (orderId: string) => number;
  resetAll: () => void;
}

export const useOrdersStore = create<OrdersState>()(
  persist(
    (set, get) => ({
      orders: [],

      createOrder: (tableId, customerId, guestName) => {
        const order: CanteenOrder = {
          id: crypto.randomUUID(),
          tableId,
          customerId,
          guestName: guestName ?? null,
          items: [],
          note: "",
          status: "pending",
          createdAt: Date.now(),
        };
        set((state) => ({ orders: [...state.orders, order] }));
        pushInsert(TABLE, toRow(order));
        return order;
      },

      getOpenOrderForTable: (tableId) =>
        get().orders.find((o) => o.tableId === tableId && o.status !== "billed"),

      addItem: (orderId, item) => {
        useMenuStore.getState().deductStock(item.menuItemId, item.qty);
        set((state) => ({
          orders: state.orders.map((o) => {
            if (o.id !== orderId) return o;
            const existing = o.items.find((i) => i.menuItemId === item.menuItemId);
            if (existing) {
              return {
                ...o,
                items: o.items.map((i) =>
                  i.menuItemId === item.menuItemId ? { ...i, qty: i.qty + item.qty } : i
                ),
              };
            }
            return { ...o, items: [...o.items, { ...item, id: crypto.randomUUID() }] };
          }),
        }));
        pushOrder(orderId);
      },

      changeQty: (orderId, lineItemId, qty) => {
        const order = get().orders.find((o) => o.id === orderId);
        const line = order?.items.find((i) => i.id === lineItemId);
        if (line) {
          const delta = qty - line.qty; // positive = ordering more, negative = returning
          if (delta > 0) useMenuStore.getState().deductStock(line.menuItemId, delta);
          if (delta < 0) useMenuStore.getState().restock(line.menuItemId, -delta);
        }
        set((state) => ({
          orders: state.orders.map((o) =>
            o.id === orderId
              ? {
                  ...o,
                  items:
                    qty <= 0
                      ? o.items.filter((i) => i.id !== lineItemId)
                      : o.items.map((i) => (i.id === lineItemId ? { ...i, qty } : i)),
                }
              : o
          ),
        }));
        pushOrder(orderId);
      },

      removeItem: (orderId, lineItemId) => {
        const order = get().orders.find((o) => o.id === orderId);
        const line = order?.items.find((i) => i.id === lineItemId);
        if (line) useMenuStore.getState().restock(line.menuItemId, line.qty);
        set((state) => ({
          orders: state.orders.map((o) =>
            o.id === orderId ? { ...o, items: o.items.filter((i) => i.id !== lineItemId) } : o
          ),
        }));
        pushOrder(orderId);
      },

      setNote: (orderId, note) => {
        set((state) => ({
          orders: state.orders.map((o) => (o.id === orderId ? { ...o, note } : o)),
        }));
        pushOrder(orderId);
      },

      markServed: (orderId) => {
        set((state) => ({
          orders: state.orders.map((o) => (o.id === orderId ? { ...o, status: "served" } : o)),
        }));
        pushOrder(orderId);
      },

      markBilled: (orderId) => {
        set((state) => ({
          orders: state.orders.map((o) => (o.id === orderId ? { ...o, status: "billed" } : o)),
        }));
        pushOrder(orderId);
      },

      // Reverts an order that was marked billed when a checkout gets cancelled
      // before payment (e.g. an accidental "Stop & Bill"). Assumes it had
      // already been served, which is true for the vast majority of orders by
      // the time checkout is reached.
      unmarkBilled: (orderId) => {
        set((state) => ({
          orders: state.orders.map((o) => (o.id === orderId ? { ...o, status: "served" } : o)),
        }));
        pushOrder(orderId);
      },

      // Folds a standalone order (food ordered before a table was picked)
      // into a table's tab once a session starts, so it bills together
      // instead of sitting separately.
      reassignToTable: (orderId, tableId, customerId) => {
        set((state) => ({
          orders: state.orders.map((o) =>
            o.id === orderId ? { ...o, tableId, customerId, guestName: null } : o
          ),
        }));
        pushOrder(orderId);
      },

      orderTotal: (orderId) => {
        const order = get().orders.find((o) => o.id === orderId);
        if (!order) return 0;
        return order.items.reduce((sum, i) => sum + i.price * i.qty, 0);
      },

      resetAll: () => {
        set({ orders: [] });
        pushDeleteAll(TABLE);
      },
    }),
    {
      name: "cuebill-orders",
      version: 1,
      migrate: (persisted) => {
        const state = persisted as { orders?: (Partial<CanteenOrder> & { id: string })[] };
        return {
          orders: (state.orders ?? []).map((o) => ({
            id: o.id,
            tableId: o.tableId ?? null,
            customerId: o.customerId ?? null,
            guestName: o.guestName ?? null,
            items: o.items ?? [],
            note: o.note ?? "",
            status: o.status ?? "pending",
            createdAt: o.createdAt ?? Date.now(),
          })),
        };
      },
    }
  )
);

setupSync<OrderRow, CanteenOrder>(
  TABLE,
  fromRow,
  toRow,
  () => useOrdersStore.getState().orders,
  (orders) => useOrdersStore.setState({ orders }),
  (order) =>
    useOrdersStore.setState((state) => {
      const exists = state.orders.some((o) => o.id === order.id);
      return {
        orders: exists ? state.orders.map((o) => (o.id === order.id ? order : o)) : [...state.orders, order],
      };
    }),
  (id) => useOrdersStore.setState((state) => ({ orders: state.orders.filter((o) => o.id !== id) }))
);
