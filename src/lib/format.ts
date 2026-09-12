export function formatMoney(amount: number, symbol = "₹") {
  // Whole-rupee amounts (the common case for canteen items, round rates,
  // etc.) print clean — "₹150" not "₹150.00". Anything with real paise
  // still shows two decimals so nothing gets silently rounded away.
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  return Number.isInteger(rounded) ? `${symbol}${rounded}` : `${symbol}${rounded.toFixed(2)}`;
}

export function formatDuration(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function elapsedMinutesExact(ms: number) {
  return ms / 60000;
}

// Rounded to the nearest whole rupee — per-minute billing otherwise leaves
// odd paisa (₹29.18, ₹17.43) that doesn't match how a cash till actually
// runs here. Canteen prices are already whole rupees, so this keeps every
// table charge — and therefore every bill total built from it — clean too.
export function costForElapsed(ms: number, ratePerHour: number) {
  return Math.round((ms / 3600000) * ratePerHour);
}

// The shop is in India and stays on IST no matter what timezone a synced
// device's own clock/OS is set to — every date/time shown to staff (and
// every "today"/"this month" grouping) is pinned to Asia/Kolkata instead of
// the device's local zone.
export const IST_TIME_ZONE = "Asia/Kolkata";

// India has one fixed UTC+5:30 offset with no DST, so shifting a timestamp
// by it and reading the UTC fields back out gives IST wall-clock values
// directly, regardless of the device's own timezone setting.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function istDate(ts: number) {
  return new Date(ts + IST_OFFSET_MS);
}

export function isToday(ts: number) {
  const d = istDate(ts);
  const now = istDate(Date.now());
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  );
}

export function isThisMonth(ts: number) {
  const d = istDate(ts);
  const now = istDate(Date.now());
  return d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth();
}

// IST YYYY-MM-DD, matching what an <input type="date"> shows/expects.
export function toDateInputValue(ts: number) {
  const d = istDate(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatDateTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: IST_TIME_ZONE,
  });
}

export function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: IST_TIME_ZONE });
}

export function timeAgo(ts: number | null) {
  if (ts == null) return "Never reminded";
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "Reminded just now";
  if (mins < 60) return `Reminded ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Reminded ${hours}h ago`;
  return `Reminded ${Math.floor(hours / 24)}d ago`;
}

// Format an IST YYYY-MM-DD key (from toDateInputValue) back into a display
// label — parsed/rendered as plain UTC so it can't drift a day depending on
// the device's own timezone.
export function formatDateKey(dateKey: string, opts: Intl.DateTimeFormatOptions) {
  const [y, m, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString([], { ...opts, timeZone: "UTC" });
}
