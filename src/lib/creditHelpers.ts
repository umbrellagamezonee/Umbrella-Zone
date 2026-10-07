import { useBillsStore } from "../store/useBillsStore";
import { useOrdersStore } from "../store/useOrdersStore";
import { customerOpenBills, customerPendingOrders, orderTotal } from "./billing";

// Settling needs a real credit balance to pay off, so right before a payment
// is recorded every served-but-unbilled order is billed onto the customer's
// credit and every stuck-open bill is put on credit too (the same as paying
// them off from the Credits page always did). This used to happen the moment
// someone tapped "Settle payment" — so merely opening that screen and closing
// it again silently turned a customer's whole backlog into dated credit
// bills. It now only runs once a payment is actually being recorded.
export function billPendingToCredit(customer: { id: string; name: string }): void {
  const bills = useBillsStore.getState();
  const orders = useOrdersStore.getState();
  const pending = customerPendingOrders(orders.orders, bills.bills, customer.id);
  const open = customerOpenBills(bills.bills, customer.id);
  for (const order of pending) {
    const total = orderTotal(order);
    if (total <= 0) continue;
    const bill = bills.createOpenBill({
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
    orders.markBilled(order.id);
    bills.settlePayment(bill.id, { amountCash: 0, amountUpi: 0 });
  }
  for (const bill of open) {
    bills.settlePayment(bill.id, { amountCash: 0, amountUpi: 0 });
  }
}
