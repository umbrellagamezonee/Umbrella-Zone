import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CanteenOrder, OrderLineItem } from "../types";
import { useMenuStore } from "./useMenuStore";

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
      },

      setNote: (orderId, note) =>
        set((state) => ({
          orders: state.orders.map((o) => (o.id === orderId ? { ...o, note } : o)),
        })),

      markServed: (orderId) =>
        set((state) => ({
          orders: state.orders.map((o) => (o.id === orderId ? { ...o, status: "served" } : o)),
        })),

      markBilled: (orderId) =>
        set((state) => ({
          orders: state.orders.map((o) => (o.id === orderId ? { ...o, status: "billed" } : o)),
        })),

      // Reverts an order that was marked billed when a checkout gets cancelled
      // before payment (e.g. an accidental "Stop & Bill"). Assumes it had
      // already been served, which is true for the vast majority of orders by
      // the time checkout is reached.
      unmarkBilled: (orderId) =>
        set((state) => ({
          orders: state.orders.map((o) => (o.id === orderId ? { ...o, status: "served" } : o)),
        })),

      // Folds a standalone order (food ordered before a table was picked)
      // into a table's tab once a session starts, so it bills together
      // instead of sitting separately.
      reassignToTable: (orderId, tableId, customerId) =>
        set((state) => ({
          orders: state.orders.map((o) =>
            o.id === orderId ? { ...o, tableId, customerId, guestName: null } : o
          ),
        })),

      orderTotal: (orderId) => {
        const order = get().orders.find((o) => o.id === orderId);
        if (!order) return 0;
        return order.items.reduce((sum, i) => sum + i.price * i.qty, 0);
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
