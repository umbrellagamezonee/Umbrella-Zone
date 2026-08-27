import { useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Card } from "../components/ui/Card";
import { Modal } from "../components/ui/Modal";
import { PhoneInput } from "../components/ui/PhoneInput";
import { useCustomersStore } from "../store/useCustomersStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { formatMoney } from "../lib/format";
import { sendCreditReminder } from "../lib/reminderApi";
import { Search, Footprints, BellRing, Check } from "lucide-react";

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
                <button
                  onClick={() => handleRemindNow(c.id)}
                  disabled={sendingId === c.id}
                  className="mt-2 w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-warning)]/15 text-[var(--color-warning)] text-sm font-medium py-2 disabled:opacity-50"
                >
                  {sendingId === c.id ? (
                    <>Sending…</>
                  ) : (
                    <>
                      <BellRing size={14} /> Remind now
                    </>
                  )}
                </button>
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
          <Card key={c.id} className="flex items-center justify-between">
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
            {c.creditBalance > 0 ? (
              <span className="text-xs font-semibold text-[var(--color-warning)]">
                {formatMoney(c.creditBalance, currency)} due
              </span>
            ) : (
              !c.isWalkIn && <Check size={16} className="text-[var(--color-text-faint)]" />
            )}
          </Card>
        ))}
      </div>

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
