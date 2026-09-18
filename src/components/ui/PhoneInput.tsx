export function PhoneInput({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div
      className={
        "flex items-center rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] overflow-hidden " +
        (className ?? "")
      }
    >
      <span className="px-3 py-2.5 text-sm text-[var(--color-text-dim)] border-r border-[var(--color-border)]">
        +91
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 10))}
        placeholder="Phone number"
        inputMode="numeric"
        className="flex-1 min-w-0 bg-transparent px-3 py-2.5 text-sm outline-none"
      />
    </div>
  );
}
