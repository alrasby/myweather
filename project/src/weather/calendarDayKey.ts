/**
 * YYYY-MM-DD in the selected city's IANA time zone.
 * formatToParts avoids locale-dependent date separators/order in Android WebView.
 * Never use the handset's own time zone or parse a localized date string.
 */
export function dayKey(ms: number, timeZone: string): string {
  const date=new Date(ms);
  if (!Number.isFinite(date.getTime())) return "";
  try {
    const parts=new Intl.DateTimeFormat("en-GB", {
      timeZone, year:"numeric", month:"2-digit", day:"2-digit",
    }).formatToParts(date);
    const part=(kind: Intl.DateTimeFormatPartTypes)=>
      parts.find(p=>p.type===kind)?.value;
    const year=part("year"), month=part("month"), day=part("day");
    if (!year || !month || !day) throw new Error("missing-calendar-date-parts");
    return year+"-"+month+"-"+day;
  } catch {
    // Only invalid/unsupported time zones fall back to UTC, not device local time.
    return date.toISOString().slice(0,10);
  }
}
