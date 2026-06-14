import type { Event, FamilyRole } from '@/types';
import { DISPLAY_ORDER } from '@/lib/colors';

export interface CalendarDay {
  date: Date;
  dateStr: string;
  isCurrentMonth: boolean;
  isToday: boolean;
  holidayName: string;
}

export interface MultiDayBar {
  event: Event;
  startCol: number; // 0-6 (column within the week)
  endCol: number;   // 0-6
  barRow: number;   // 0-based vertical row in the bar section
}

export interface PersonDayChip {
  person: FamilyRole;
  primaryEvent: Event;
  extraCount: number;
}

export interface WeekData {
  days: CalendarDay[];
  multiDayBars: MultiDayBar[];
  totalBarRows: number;
  dayChips: Map<string, PersonDayChip[]>;
}

export function toDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function assignBarRows(bars: Omit<MultiDayBar, 'barRow'>[]): MultiDayBar[] {
  const result: MultiDayBar[] = [];
  for (const bar of bars) {
    let row = 0;
    for (;;) {
      const occupied = result.some(
        (r) => r.barRow === row && r.startCol <= bar.endCol && r.endCol >= bar.startCol,
      );
      if (!occupied) break;
      row++;
    }
    result.push({ ...bar, barRow: row });
  }
  return result;
}

function getPersonDayChips(dateStr: string, events: Event[]): PersonDayChip[] {
  const chips: PersonDayChip[] = [];
  for (const person of DISPLAY_ORDER) {
    const dayEvents = events.filter(
      (e) => e.person === person && !e.deleted && e.start_date <= dateStr && e.end_date >= dateStr,
    );
    if (dayEvents.length === 0) continue;

    // multi-day events first, then by created_at ASC
    dayEvents.sort((a, b) => {
      const aIsMulti = a.start_date !== a.end_date ? 0 : 1;
      const bIsMulti = b.start_date !== b.end_date ? 0 : 1;
      if (aIsMulti !== bIsMulti) return aIsMulti - bIsMulti;
      return a.created_at.localeCompare(b.created_at);
    });

    chips.push({ person, primaryEvent: dayEvents[0], extraCount: dayEvents.length - 1 });
  }
  return chips;
}

export function buildCalendarWeeks(
  year: number,
  month: number,
  events: Event[],
  holidays: Map<string, string>,
): WeekData[] {
  const todayStr = toDateStr(new Date());
  const multiDayEvents = events.filter((e) => !e.deleted && e.start_date !== e.end_date);

  // Sunday of the week containing the 1st of the month
  const firstOfMonth = new Date(year, month - 1, 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(1 - firstOfMonth.getDay());

  const weeks: WeekData[] = [];

  for (let w = 0; w < 6; w++) {
    const days: CalendarDay[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + w * 7 + d);
      const dateStr = toDateStr(date);
      days.push({
        date,
        dateStr,
        isCurrentMonth: date.getFullYear() === year && date.getMonth() + 1 === month,
        isToday: dateStr === todayStr,
        holidayName: holidays.get(dateStr) ?? '',
      });
    }

    const weekStartStr = days[0].dateStr;
    const weekEndStr = days[6].dateStr;

    const weekMultiDays = multiDayEvents
      .filter((e) => e.start_date <= weekEndStr && e.end_date >= weekStartStr)
      .sort((a, b) => a.start_date.localeCompare(b.start_date));

    const barsWithoutRow = weekMultiDays.map((e) => ({
      event: e,
      startCol: e.start_date <= weekStartStr ? 0 : days.findIndex((d) => d.dateStr === e.start_date),
      endCol: e.end_date >= weekEndStr ? 6 : days.findIndex((d) => d.dateStr === e.end_date),
    }));

    const multiDayBars = assignBarRows(barsWithoutRow);
    const totalBarRows = multiDayBars.length > 0 ? Math.max(...multiDayBars.map((b) => b.barRow)) + 1 : 0;

    const dayChips = new Map<string, PersonDayChip[]>();
    for (const day of days) {
      dayChips.set(day.dateStr, getPersonDayChips(day.dateStr, events));
    }

    weeks.push({ days, multiDayBars, totalBarRows, dayChips });
  }

  return weeks;
}
