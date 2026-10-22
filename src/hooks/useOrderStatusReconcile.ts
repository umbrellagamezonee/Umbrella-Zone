import { useEffect } from "react";
import { useBillsStore } from "../store/useBillsStore";
import { useOrdersStore } from "../store/useOrdersStore";

// An order that already has a bill must read "billed". Before writes were made
// durable (see lib/syncQueue.ts) the "billed" flag could silently fail to reach
// the cloud and get reverted on the next sync, leaving orders showing "served"
// — with a Checkout button — long after their bill existed, which is how one
// order ended up billed twice. This puts the flag right again for any such
// order (and keeps doing so, cheaply, in case a device with an older copy of
// the app syncs one back). It only ever moves an order TO "billed", and only
// when a live bill really exists for it.
export function reconcileOrderStatuses() {
  const orders = useOrdersStore.getState().orders;
  if (orders.length === 0) return;
  const billed = new Set<string>();
  for (const b of useBillsStore.getState().bills) {
    if (b.orderId && b.status !== "cancelled") billed.add(b.orderId);
  }
  if (billed.size === 0) return;
  const { markBilled } = useOrdersStore.getState();
  for (const o of orders) {
    if (o.status !== "billed" && billed.has(o.id)) markBilled(o.id);
  }
}

export function useOrderStatusReconcile() {
  useEffect(() => {
    // wait for the first sync to land, then keep an eye on it
    const first = setTimeout(reconcileOrderStatuses, 12_000);
    const again = setInterval(reconcileOrderStatuses, 90_000);
    return () => {
      clearTimeout(first);
      clearInterval(again);
    };
  }, []);
}
