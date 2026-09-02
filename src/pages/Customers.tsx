import { useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Card } from "../components/ui/Card";
import { Modal } from "../components/ui/Modal";
import { PhoneInput } from "../components/ui/PhoneInput";
import { BillDetailModal } from "../components/BillDetailModal";
import { useCustomersStore } from "../store/useCustomersStore";
import { useBillsStore } from "../store/useBillsStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { formatMoney, formatDateTime } from "../lib/format";
import { billCollected } from "../lib/billing";
import { sendCreditReminder } from "../lib/reminderApi";
import type { Customer, Bill, PaymentMethod } from "../types";
import { Search, Footprints, BellRing, Check, ChevronRight, Wallet } from "lucide-react";

function timeAgo(ts: number | null) {
  if (ts == null) return "Never reminded";
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "Reminded just now";
  if (mins < 60) return `Reminded ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Reminded ${hours}h ago`;
  return `Reminded ${Math.floor(hours / 24)}d ago`;
}

export function Customers() {
  const customers = useCustomersStore((s) => s.customers);
  const addCustomer = useCustomersStore((s) => s.addCustomer);
  const markReminded = useCustomersStore((s) => s.markReminded);
  const currency = useSettingsStore((s) => s.currencySymbol);
  const storeName = useSettingsStore((s) => s.storeName);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; ok: boolean } | null>(null);
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);
  const [settleCustomer, setSettleCustomer] = useState<Customer | null>(null);

  const dueCustomers = customers.filter((c) => !c.isWalkIn && c.creditBalance > 0);

  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search) ||
      c.email.toLowerCase().includes(search.toLowerCase())
  );

  function handleAdd() {
    if (!name.trim()) return;
    addCustomer({ name: name.trim(), phone, email });
    setName("");
    setPhone("");
    setEmail("");
    setShowAdd(false);
  }

  async function handleRemindNow(id: string) {
    const c = customers.find((x) => x.id === id);
    if (!c) return;
    setSendingId(id);
    setNotice(null);
    const sent = await sendCreditReminder({
      customerId: c.id,
      name: c.name,
      phone: c.phone,
      amountDue: c.creditBalance,
      storeName,
      currencySymbol: currency,
    });
    if (sent) markReminded(id);
    setSendingId(null);
    setNotice({ id, ok: sent });
  }

  return (
    <AppShell title="Customers">
      {dueCustomers.length > 0 && (
        <div>
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">
            PAYMENT DUE
          </p>
          <div className="space-y-2">
            {dueCustomers.map((c) => (
              <Card key={c.id} className="border-[var(--color-warning)]/40">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-[var(--color-text-dim)]">
                      {c.phone || "No phone"} · {timeAgo(c.lastReminderAt)}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-[var(--color-warning)]">
                    {formatMoney(c.creditBalance, currency)}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setSettleCustomer(c)}
                    className="flex items-center justify-center gap-2 rounded-xl bg-[var(--color-success)]/15 text-[var(--color-success)] text-sm font-medium py-2"
                  >
                    <Wallet size={14} /> Settle
                  </button>
                  <button
                    onClick={() => handleRemindNow(c.id)}
                    disabled={sendingId === c.id}
                    className="flex items-center justify-center gap-2 rounded-xl bg-[var(--color-warning)]/15 text-[var(--color-warning)] text-sm font-medium py-2 disabled:opacity-50"
                  >
                    {sendingId === c.id ? (
                      <>Sending…</>
                    ) : (
                      <>
                        <BellRing size={14} /> Remind
                      </>
                    )}
                  </button>
                </div>
                {notice?.id === c.id && (
                  <p
                    className={
                      "text-xs text-center mt-1.5 " +
                      (notice.ok ? "text-[var(--color-success)]" : "text-[var(--color-text-faint)]")
                    }
                  >
                    {notice.ok
                      ? "Message sent."
                      : "Not sent — reminder server isn't running/configured (see server/README.md)."}
                  </p>
                )}
              </Card>
            ))}
          </div>
          <p className="text-xs text-[var(--color-text-faint)] mt-2">
            Auto-reminded every 24 hours while the app is open. Real WhatsApp/SMS sending needs
            the reminder server running with Twilio credentials — see server/README.md.
          </p>
        </div>
      )}

      <div className="relative">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)]"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, phone, email"
          className="w-full rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] pl-9 pr-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary)]"
        />
      </div>

      <button
        onClick={() => setShowAdd(true)}
        className="w-full rounded-xl bg-[var(--color-primary)] text-white font-semibold py-3"
      >
        Add customer
      </button>

      <div className="space-y-2">
        {filtered.map((c) => (
          <Card
            key={c.id}
            onClick={c.isWalkIn ? undefined : () => setDetailCustomer(c)}
            className="flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-[var(--color-surface-2)] flex items-center justify-center">
                {c.isWalkIn ? (
                  <Footprints size={18} className="text-[var(--color-accent)]" />
                ) : (
                  <span className="text-sm font-semibold">
                    {c.name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <div>
                <p className="text-sm font-medium">{c.name}</p>
                <p className="text-xs text-[var(--color-text-dim)]">
                  {c.phone || (c.isWalkIn ? "System" : "No phone")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {c.creditBalance > 0 ? (
                <span className="text-xs font-semibold text-[var(--color-warning)]">
                  {formatMoney(c.creditBalance, currency)} due
                </span>
              ) : (
                !c.isWalkIn && <Check size={16} className="text-[var(--color-text-faint)]" />
              )}
              {!c.isWalkIn && <ChevronRight size={16} className="text-[var(--color-text-faint)]" />}
            </div>
          </Card>
        ))}
      </div>

      {detailCustomer && (
        <CustomerDetailModal customer={detailCustomer} onClose={() => setDetailCustomer(null)} />
      )}

      {settleCustomer && (
        <SettleCreditModal customer={settleCustomer} onClose={() => setSettleCustomer(null)} />
      )}

      {showAdd && (
        <Modal title="Add customer" onClose={() => setShowAdd(false)}>
          <div className="space-y-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
            />
            <PhoneInput value={phone} onChange={setPhone} />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email (optional)"
              className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
            />
            <button
              onClick={handleAdd}
              className="w-full rounded-xl bg-[var(--color-primary)] text-white font-semibold py-3"
            >
              Save
            </button>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}

// Everything this one customer has done — every visit, what it cost, and
// (tapping into one) exactly what was ordered and who they played — so the
// answer to "when did they last come in, what do they usually order" is one
// tap away instead of scrolling through Reports guessing at names.
function CustomerDetailModal({ customer: initialCustomer, onClose }: { customer: Customer; onClose: () => void }) {
  const bills = useBillsStore((s) => s.bills);
  // Deleted bills too — a credit balance doesn't get reversed when the bill
  // that created it is trashed, so leaving those out would hide exactly the
  // history someone's most likely trying to track down.
  const deletedBills = useBillsStore((s) => s.deletedBills);
  const currency = useSettingsStore((s) => s.currencySymbol);
  const [detailBill, setDetailBill] = useState<Bill | null>(null);
  const [showSettle, setShowSettle] = useState(false);
  // Read live off the store — settling a payment from right here should
  // update the balance on screen immediately, not just after closing and
  // reopening this modal.
  const customer =
    useCustomersStore((s) => s.customers.find((c) => c.id === initialCustomer.id)) ?? initialCustomer;

  const matchesCustomer = (b: Bill) =>
    b.customerId === customer.id ||
    b.matchParticipants?.includes(customer.name) ||
    b.shares?.some((s) => s.payerName === customer.name);

  const customerBills = [...bills, ...deletedBills]
    .filter(matchesCustomer)
    .sort((a, b) => b.createdAt - a.createdAt);
  const deletedCount = customerBills.filter((b) => b.deletedAt).length;

  const totalSpent = customerBills.reduce((sum, b) => sum + billCollected(b), 0);

  return (
    <Modal title={customer.name} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <p className="text-xs text-[var(--color-text-dim)]">VISITS</p>
            <p className="text-xl font-bold mt-1">
              {customerBills.length - deletedCount}
            </p>
          </Card>
          <Card>
            <p className="text-xs text-[var(--color-text-dim)]">TOTAL SPENT</p>
            <p className="text-xl font-bold text-[var(--color-success)] mt-1">
              {formatMoney(totalSpent, currency)}
            </p>
          </Card>
        </div>

        {customer.creditBalance > 0 && (
          <Card className="border-[var(--color-warning)]/40">
            <p className="text-xs text-[var(--color-text-dim)]">CREDIT DUE</p>
            <p className="text-lg font-bold text-[var(--color-warning)] mt-1">
              {formatMoney(customer.creditBalance, currency)}
            </p>
            {deletedCount > 0 && (
              <p className="text-xs text-[var(--color-text-faint)] mt-1">
                {deletedCount} bill{deletedCount > 1 ? "s" : ""} below {deletedCount > 1 ? "were" : "was"}{" "}
                deleted — check them for what added to this. Older credit changes with no bill left
                at all (permanently deleted, or from before this device tracked history) can't be
                traced back further than that.
              </p>
            )}
            <button
              onClick={() => setShowSettle(true)}
              className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-success)]/15 text-[var(--color-success)] text-sm font-medium py-2.5"
            >
              <Wallet size={14} /> Settle payment
            </button>
          </Card>
        )}

        <div>
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">
            HISTORY
          </p>
          {customerBills.length === 0 ? (
            <p className="text-sm text-[var(--color-text-faint)] text-center py-6">
              No sessions yet.
            </p>
          ) : (
            <div className="space-y-2">
              {customerBills.map((b) => (
                <Card
                  key={b.id}
                  onClick={() => setDetailBill(b)}
                  className={b.status === "cancelled" || b.deletedAt ? "opacity-50" : ""}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">
                        {b.tableName ?? "Canteen order"}
                        {b.deletedAt && (
                          <span className="text-[var(--color-danger)] font-normal"> · Deleted</span>
                        )}
                      </p>
                      <p className="text-xs text-[var(--color-text-dim)]">{formatDateTime(b.createdAt)}</p>
                      {b.canteenItems.length > 0 && (
                        <p className="text-xs text-[var(--color-text-faint)] mt-0.5">
                          {b.canteenItems.map((i) => i.name).join(", ")}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold">{formatMoney(b.total, currency)}</p>
                      {b.status === "paid" && b.amountPaid > 0 && (
                        <p className="text-xs text-[var(--color-success)] flex items-center gap-1 justify-end">
                          <Check size={11} /> Paid
                        </p>
                      )}
                      {b.amountDue > 0 && (
                        <p className="text-xs text-[var(--color-warning)]">
                          {formatMoney(b.amountDue, currency)} on credit
                        </p>
                      )}
                      {b.status === "open" && (
                        <p className="text-xs text-[var(--color-warning)]">Open</p>
                      )}
                      {b.status === "cancelled" && (
                        <p className="text-xs text-[var(--color-text-faint)]">Cancelled</p>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {detailBill && <BillDetailModal bill={detailBill} onClose={() => setDetailBill(null)} />}
      {showSettle && <SettleCreditModal customer={customer} onClose={() => setShowSettle(false)} />}
    </Modal>
  );
}

// Collects a credit payment (cash/UPI), with an optional discount to write
// off part of what's owed — recorded as its own settled bill so it counts
// toward the day's collection, not just a number quietly shrinking.
function SettleCreditModal({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const currency = useSettingsStore((s) => s.currencySymbol);
  const recordCreditSettlement = useBillsStore((s) => s.recordCreditSettlement);
  const adjustCredit = useCustomersStore((s) => s.adjustCredit);

  const [discountInput, setDiscountInput] = useState("0");
  const [amountInput, setAmountInput] = useState(customer.creditBalance.toFixed(2));
  const [settled, setSettled] = useState<{ method: PaymentMethod; amountPaid: number; discount: number } | null>(
    null
  );

  const discount = Math.min(Math.max(0, Number(discountInput) || 0), customer.creditBalance);
  const amountPaid = Math.min(Math.max(0, Number(amountInput) || 0), customer.creditBalance - discount);
  const remaining = Math.max(0, customer.creditBalance - amountPaid - discount);
  const canSettle = amountPaid > 0 || discount > 0;

  function handleSettle(method: PaymentMethod) {
    if (!canSettle) return;
    recordCreditSettlement({
      customerId: customer.id,
      customerName: customer.name,
      amountPaid,
      discount,
      method,
    });
    adjustCredit(customer.id, -(amountPaid + discount));
    setSettled({ method, amountPaid, discount });
  }

  if (settled) {
    return (
      <Modal title={customer.name} onClose={onClose}>
        <div className="space-y-4 py-4 text-center">
          <div className="mx-auto h-16 w-16 rounded-full bg-[var(--color-success)]/15 text-[var(--color-success)] flex items-center justify-center">
            <Check size={32} />
          </div>
          <div>
            {settled.amountPaid > 0 && (
              <p className="text-2xl font-bold">{formatMoney(settled.amountPaid, currency)}</p>
            )}
            {settled.amountPaid > 0 && (
              <p className="text-sm text-[var(--color-text-dim)] mt-1">
                Received via {settled.method === "upi" ? "UPI" : "Cash"}
              </p>
            )}
            {settled.discount > 0 && (
              <p className="text-sm text-[var(--color-warning)] mt-2">
                {formatMoney(settled.discount, currency)} written off
              </p>
            )}
            <p className="text-sm text-[var(--color-text-dim)] mt-2">
              {remaining > 0
                ? `${formatMoney(remaining, currency)} still due`
                : "Credit fully cleared"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-full rounded-xl bg-[var(--color-primary)] text-white font-semibold py-3"
          >
            Done
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Settle · ${customer.name}`} onClose={onClose}>
      <div className="space-y-4">
        <Card>
          <div className="flex justify-between text-sm">
            <span className="text-[var(--color-text-dim)]">Total due</span>
            <span className="font-semibold">{formatMoney(customer.creditBalance, currency)}</span>
          </div>
        </Card>

        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--color-text-dim)]">Discount</span>
          <input
            type="number"
            min={0}
            max={customer.creditBalance}
            value={discountInput}
            onChange={(e) => {
              const raw = e.target.value;
              setDiscountInput(raw);
              // Keep "Receiving now" visually honest — raising the discount
              // shouldn't leave a stale amount sitting there that adds up to
              // more than what's actually owed.
              const newDiscount = Math.min(Math.max(0, Number(raw) || 0), customer.creditBalance);
              const maxAmount = customer.creditBalance - newDiscount;
              setAmountInput((prev) => ((Number(prev) || 0) > maxAmount ? maxAmount.toFixed(2) : prev));
            }}
            className="w-24 text-right bg-[var(--color-surface-2)] rounded-lg px-2 py-1.5 text-sm outline-none"
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--color-text-dim)]">Receiving now</span>
          <input
            type="number"
            min={0}
            max={customer.creditBalance - discount}
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            className="w-24 text-right bg-[var(--color-surface-2)] rounded-lg px-2 py-1.5 text-sm outline-none"
          />
        </div>

        <p className="text-xs text-[var(--color-text-faint)] -mt-2">
          {remaining > 0
            ? `${formatMoney(remaining, currency)} will still be due after this.`
            : "This clears their credit completely."}
        </p>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => handleSettle("cash")}
            disabled={!canSettle}
            className="rounded-xl bg-[var(--color-success)]/15 text-[var(--color-success)] font-semibold py-3 text-sm disabled:opacity-40"
          >
            Cash
          </button>
          <button
            onClick={() => handleSettle("upi")}
            disabled={!canSettle}
            className="rounded-xl bg-[var(--color-primary)]/15 text-[var(--color-primary)] font-semibold py-3 text-sm disabled:opacity-40"
          >
            UPI
          </button>
        </div>
      </div>
    </Modal>
  );
}
