/**
 * 「今日」と「今月」は日本時間で決める。
 *
 * Codespace のサーバーは UTC で動いているため、new Date().getMonth() などをそのまま使うと、
 * 毎月 1 日の 0〜9 時（日本時間）は前の月として扱われてしまう。
 */
const TOKYO = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** 日本時間の今日 "YYYY-MM-DD" */
export function todayInTokyo(now = new Date()) {
  return TOKYO.format(now);
}

/** 日本時間の今月 { year, month, key: "YYYY-MM" } */
export function thisMonthInTokyo(now = new Date()) {
  const today = todayInTokyo(now);
  return { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)), key: today.slice(0, 7) };
}

/** URL の ?month=YYYY-MM を読む。無い・壊れていれば日本時間の今月 */
export function resolveMonthParam(value: unknown, now = new Date()) {
  if (typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    return { year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)), key: value };
  }
  return thisMonthInTokyo(now);
}
