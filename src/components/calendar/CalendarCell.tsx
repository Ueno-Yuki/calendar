'use client';

import type { CalendarDay, PersonDayChip } from '@/lib/calendarUtils';
import { FAMILY_COLORS } from '@/lib/colors';

interface Props {
  day: CalendarDay;
  dayOfWeek: number; // 0=Sun, 6=Sat
  chips: PersonDayChip[];
  onPress: () => void;
}

export default function CalendarCell({ day, dayOfWeek, chips, onPress }: Props) {
  const { date, isCurrentMonth, isToday, holidayName } = day;
  const dayNum = date.getDate();

  let dateTextClass = 'text-zinc-900';
  if (!isCurrentMonth) {
    dateTextClass = 'text-zinc-300';
  } else if (dayOfWeek === 0 || holidayName) {
    dateTextClass = 'text-red-500';
  } else if (dayOfWeek === 6) {
    dateTextClass = 'text-blue-500';
  }

  return (
    <button
      type="button"
      onClick={onPress}
      className={`flex flex-col items-start w-full h-full p-1 text-left overflow-hidden ${
        isToday ? 'ring-2 ring-inset ring-zinc-700' : ''
      }`}
    >
      <span
        className={`text-xs font-medium leading-5 w-5 h-5 flex items-center justify-center rounded-full ${dateTextClass}`}
      >
        {dayNum}
      </span>
      {holidayName && isCurrentMonth && (
        <span className="text-[9px] text-red-500 leading-tight w-full truncate">
          {holidayName}
        </span>
      )}
      {/* タイトルのみ表示。対象者は文字色で判別。件数表示なし。 */}
      <div className="flex flex-col gap-px w-full mt-0.5 overflow-hidden">
        {chips.map((chip) => {
          const color = FAMILY_COLORS[chip.person];
          return (
            <div
              key={chip.person}
              style={{ color: color.main }}
              className="text-[9px] leading-4 truncate"
            >
              {chip.primaryEvent.title}
            </div>
          );
        })}
      </div>
    </button>
  );
}
