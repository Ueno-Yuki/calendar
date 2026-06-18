'use client';

import type { PersonDayChip } from '@/lib/calendarUtils';
import { FAMILY_COLORS } from '@/lib/colors';

interface Props {
  chips: PersonDayChip[];
  isToday?: boolean;
  onPress: () => void;
  contentOffsetTop?: number;
}

export default function CalendarCell({ chips, isToday, onPress, contentOffsetTop = 0 }: Props) {
  return (
    <button
      type="button"
      onClick={onPress}
      className={`relative flex flex-col items-start w-full h-full p-0.5 overflow-hidden focus:outline-none ${isToday ? 'bg-slate-100' : ''}`}
    >
      <div className="flex flex-col gap-px w-full overflow-hidden" style={{ marginTop: contentOffsetTop }}>
        {chips.map((chip) => {
          const color = FAMILY_COLORS[chip.person];
          const isAllDayLike = chip.primaryEvent.all_day || !chip.primaryEvent.start_time;
          if (isAllDayLike) {
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
