// hi
// Formatting helpers. Times are always shown in IST so the demo reads the same
// on any laptop, whatever its timezone.

const TZ = "Asia/Kolkata";

const kwFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inrFormat = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const timeFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const dateFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: TZ,
  weekday: "short",
  day: "numeric",
  month: "short",
});
const hourFormat = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "numeric", hour12: false });

/** 1240 -> "1,240 kW"; values of 1000+ kW stay in kW (operators read kW). */
export const formatKw = (kw: number) => `${kwFormat.format(kw)} kW`;
export const formatNumber = (n: number, digits = 0) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
/** 41250 -> "₹41,250" */
export const formatInr = (inr: number) => inrFormat.format(inr);
export const formatPct = (pct: number, digits = 0) => `${formatNumber(pct, digits)}%`;
/** Date -> "17:20" (IST) */
export const formatTime = (d: Date | string | number) => timeFormat.format(new Date(d));
/** Date -> "Tue, 12 May" (IST) */
export const formatDate = (d: Date | string | number) => dateFormat.format(new Date(d));
/** Hour of day in IST, 0-23. */
export const istHour = (d: Date | string | number) => Number(hourFormat.format(new Date(d))) % 24;

export function greeting(d: Date) {
  const h = istHour(d);
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
