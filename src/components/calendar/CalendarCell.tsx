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
      <div className="flex flex-col gap-px w-full mt-0.5">
        {chips.map((chip) => {
          const color = FAMILY_COLORS[chip.person];
          return (
            <div
              key={chip.person}
              style={{
                backgroundColor: chip.primaryEvent.all_day ? color.main : color.light,
                color: chip.primaryEvent.all_day ? '#fff' : color.main,
              }}
              className="text-[9px] px-0.5 rounded leading-4 truncate"
            >
              {color.label} {chip.primaryEvent.title}
              {chip.extraCount > 0 ? ` +${chip.extraCount}` : ''}
            </div>
          );
        })}
      </div>
    </button>
  );
}
