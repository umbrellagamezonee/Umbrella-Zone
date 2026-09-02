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

export function costForElapsed(ms: number, ratePerHour: number) {
  return (ms / 3600000) * ratePerHour;
}

export function isToday(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function isThisMonth(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

// Local (not UTC) YYYY-MM-DD, matching what an <input type="date"> shows/expects.
export function toDateInputValue(ts: number) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatDateTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
