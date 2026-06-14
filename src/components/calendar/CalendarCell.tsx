'use client';

import type { PersonDayChip } from '@/lib/calendarUtils';
import { FAMILY_COLORS } from '@/lib/colors';

interface Props {
  chips: PersonDayChip[];
  onPress: () => void;
}

export default function CalendarCell({ chips, onPress }: Props) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="flex flex-col items-start w-full h-full p-0.5 overflow-hidden focus:outline-none"
    >
      <div className="flex flex-col gap-px w-full overflow-hidden">
        {chips.map((chip) => {
          const color = FAMILY_COLORS[chip.person];
          const isAllDay = chip.primaryEvent.all_day;
          if (isAllDay) {
            // 終日予定: 対象者カラー背景 + 白文字
            return (
              <div
                key={chip.person}
                style={{ backgroundColor: color.main, color: 'white' }}
                className="w-full rounded text-[9px] leading-4 truncate px-1"
              >
                {chip.primaryEvent.title}
              </div>
            );
          }
          // 時間指定予定: 左ボーダー + 薄色背景 + 対象者カラー文字
          return (
            <div
              key={chip.person}
              style={{
                borderLeftColor: color.main,
                backgroundColor: color.light,
                color: color.main,
              }}
              className="w-full border-l-2 rounded-r text-[9px] leading-4 truncate pl-0.5 pr-0.5"
            >
              {chip.primaryEvent.title}
            </div>
          );
        })}
      </div>
    </button>
  );
}
