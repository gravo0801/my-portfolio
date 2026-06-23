const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const KR_FIXED_MARKET_HOLIDAYS = new Set([
  "01-01",
  "03-01",
  "05-01",
  "05-05",
  "06-06",
  "08-15",
  "10-03",
  "10-09",
  "12-25",
  "12-31",
]);

const KR_DATED_MARKET_HOLIDAYS = new Set([
  "2026-02-16",
  "2026-02-17",
  "2026-02-18",
  "2026-03-02",
  "2026-05-25",
  "2026-06-03",
  "2026-07-17",
  "2026-08-17",
  "2026-09-24",
  "2026-09-25",
  "2026-10-05",
]);

function pad2(value) {
  return String(value).padStart(2, "0");
}

export function getKstParts(date = new Date()) {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth() + 1;
  const day = kst.getUTCDate();
  const hour = kst.getUTCHours();
  const minute = kst.getUTCMinutes();

  return {
    year,
    month,
    day,
    hour,
    minute,
    dayOfWeek: kst.getUTCDay(),
    minutes: hour * 60 + minute,
    ymd: `${year}-${pad2(month)}-${pad2(day)}`,
    md: `${pad2(month)}-${pad2(day)}`,
  };
}

export function isKoreanMarketHoliday(date = new Date()) {
  const { dayOfWeek, ymd, md } = getKstParts(date);
  if (dayOfWeek === 0 || dayOfWeek === 6) return true;
  if (KR_DATED_MARKET_HOLIDAYS.has(ymd)) return true;
  return KR_FIXED_MARKET_HOLIDAYS.has(md);
}

export function getKoreanMarketState(date = new Date()) {
  if (isKoreanMarketHoliday(date)) return "CLOSED";

  const { minutes } = getKstParts(date);
  if (minutes >= 8 * 60 && minutes < 9 * 60) return "PRE";
  if (minutes >= 9 * 60 && minutes < 15 * 60 + 30) return "REGULAR";
  if (minutes >= 15 * 60 + 30 && minutes < 20 * 60) return "POST";
  return "CLOSED";
}
