import { useEffect } from "react";
import { useOrdersStore } from "../store/useOrdersStore";
import { useBillsStore } from "../store/useBillsStore";
import { useCustomersStore } from "../store/useCustomersStore";

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // check every 15 minutes while the app is open
const AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// Runs while the app is open: anything left unpaid for a full day gets
// written off to the customer's credit account automatically, instead of
// sitting unresolved forever with nobody noticing.
//
// Two cases:
//  1. A served canteen order (sent to a real customer's profile to pay —
//     see Customers → that customer's pending orders) that's still sitting
//     there unbilled 24h later.
//  2. A table/canteen bill that was created (Stop & Bill, or billing a
//     canteen order) but never got a payment recorded — checkout was opened
//     and abandoned, or the app closed mid-payment.
// Split (shares) bills are left alone here — a partially-paid split is a
// deliberate in-progress state, not neglect, and auto-crediting it could
// clobber payment collection that's still actively happening.
export function useAutoCreditWatcher() {
  useEffect(() => {
    function sweep() {
      const now = Date.now();

      const { orders, markBilled } = useOrdersStore.getState();
      const { bills, createOpenBill, settlePayment } = useBillsStore.getState();
      const { customers, adjustCredit } = useCustomersStore.getState();

      const staleServedOrders = orders.filter(
        (o) =>
          o.status === "served" &&
          o.tableId === null &&
          o.customerId &&
          o.customerId !== "walk-in" &&
          now - o.createdAt > AGE_MS &&
          !bills.some((b) => b.orderId === o.id)
      );
      for (const order of staleServedOrders) {
        const total = order.items.reduce((sum, i) => sum + i.price * i.qty, 0);
        if (total <= 0) continue;
        const customer = customers.find((c) => c.id === order.customerId);
        if (!customer) continue;
        const bill = createOpenBill({
          tableId: null,
          tableName: customer.name,
          orderId: order.id,
          gameId: null,
          gameName: null,
          customerId: customer.id,
          tableChargeMinutes: 0,
          tableCharge: 0,
          canteenCharge: total,
          canteenItems: order.items.map((i) => ({
            name: i.name,
            price: i.price,
            qty: i.qty,
            personName: i.personName ?? null,
          })),
          discount: 0,
        });
        markBilled(order.id);
        const settled = settlePayment(bill.id, { amountCash: 0, amountUpi: 0 });
        if (settled) adjustCredit(customer.id, settled.amountDue);
      }

      const staleOpenBills = bills.filter(
        (b) => b.status === "open" && !b.shares && b.customerId && now - b.createdAt > AGE_MS
      );
      for (const bill of staleOpenBills) {
        const settled = settlePayment(bill.id, { amountCash: 0, amountUpi: 0 });
        if (settled) adjustCredit(bill.customerId!, settled.amountDue);
      }
    }

    sweep();
    const id = setInterval(sweep, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);
}
