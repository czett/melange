export function parseXmltvDate(ts: string): Date | null {
  const digits = ts.replace(/\D/g, "");
  if (digits.length < 12) return null;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6)) - 1;
  const day = Number(digits.slice(6, 8));
  const hour = Number(digits.slice(8, 10));
  const minute = Number(digits.slice(10, 12));
  const second = digits.length >= 14 ? Number(digits.slice(12, 14)) : 0;
  return new Date(Date.UTC(year, month, day, hour, minute, second));
}

export function formatXmltvTime(ts: string): string {
  const d = parseXmltvDate(ts);
  if (!d) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function computeEpgProgress(startTs: string, stopTs: string): number {
  const start = parseXmltvDate(startTs)?.getTime();
  const stop = parseXmltvDate(stopTs)?.getTime();
  if (!start || !stop || stop <= start) return 0;
  const now = Date.now();
  const pct = ((now - start) / (stop - start)) * 100;
  return Math.max(0, Math.min(100, pct));
}
