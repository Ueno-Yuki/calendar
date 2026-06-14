import holiday_jp from '@holiday-jp/holiday_jp';

function toDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getHolidaysForMonth(year: number, month: number): Map<string, string> {
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0); // last day of month
  const holidays = holiday_jp.between(first, last);
  const map = new Map<string, string>();
  for (const h of holidays) {
    map.set(toDateStr(h.date), h.name);
  }
  return map;
}
