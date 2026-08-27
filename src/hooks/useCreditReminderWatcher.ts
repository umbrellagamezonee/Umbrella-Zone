import { useEffect } from "react";
import { useCustomersStore } from "../store/useCustomersStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { sendCreditReminder } from "../lib/reminderApi";

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes while the app is open
const REMINDER_GAP_MS = 24 * 60 * 60 * 1000; // remind at most once per 24 hours

// Runs while the app is open: any customer with an outstanding credit balance
// who hasn't been reminded in the last 24 hours gets a fresh reminder attempt
// (real send requires the server/ reminder backend to be running and configured).
export function useCreditReminderWatcher() {
  const markReminded = useCustomersStore((s) => s.markReminded);

  useEffect(() => {
    function check() {
      const now = Date.now();
      const due = useCustomersStore
        .getState()
        .customers.filter(
          (c) =>
            !c.isWalkIn &&
            c.creditBalance > 0 &&
            (c.lastReminderAt == null || now - c.lastReminderAt > REMINDER_GAP_MS)
        );
      // Read settings fresh each check rather than closing over them, so a
      // store-name/currency change takes effect on the very next reminder.
      const { storeName, currencySymbol } = useSettingsStore.getState();

      due.forEach(async (c) => {
        const sent = await sendCreditReminder({
          customerId: c.id,
          name: c.name,
          phone: c.phone,
          amountDue: c.creditBalance,
          storeName,
          currencySymbol,
        });
        // Only stamp lastReminderAt on an actual send — otherwise a customer
        // whose reminder failed (backend down/not configured) would silently
        // wait a full day before the next attempt instead of retrying soon.
        if (sent) markReminded(c.id);
      });
    }

    check();
    const id = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
