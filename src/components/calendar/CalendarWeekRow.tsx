'use client';

import type { WeekData } from '@/lib/calendarUtils';
import { FAMILY_COLORS } from '@/lib/colors';
import CalendarCell from './CalendarCell';

const BAR_HEIGHT = 18;
const BAR_GAP = 2;

interface Props {
  weekData: WeekData;
  onDayPress: (dateStr: string) => void;
}

export default function CalendarWeekRow({ weekData, onDayPress }: Props) {
  const { days, multiDayBars, totalBarRows, dayChips } = weekData;
  const barSectionHeight = totalBarRows * (BAR_HEIGHT + BAR_GAP);

  return (
    <div className="border-b border-zinc-100 flex-1 flex flex-col min-h-0">
      {/* Multi-day event bars */}
      {totalBarRows > 0 && (
        <div className="relative shrink-0" style={{ height: barSectionHeight }}>
          {multiDayBars.map((bar, i) => {
            const leftPct = `${(bar.startCol / 7) * 100}%`;
            const widthPct = `${((bar.endCol - bar.startCol + 1) / 7) * 100}%`;
            const top = bar.barRow * (BAR_HEIGHT + BAR_GAP);
            const color = FAMILY_COLORS[bar.event.person];
            const isStart = bar.startCol === days.findIndex((d) => d.dateStr === bar.event.start_date);
            const isEnd = bar.endCol === days.findIndex((d) => d.dateStr === bar.event.end_date);
            return (
              <div
                key={`${bar.event.id}-${i}`}
                style={{
                  position: 'absolute',
                  left: leftPct,
                  width: widthPct,
                  top,
                  height: BAR_HEIGHT,
                  backgroundColor: color.main,
                  borderRadius: `${isStart ? 4 : 0}px ${isEnd ? 4 : 0}px ${isEnd ? 4 : 0}px ${isStart ? 4 : 0}px`,
                  paddingLeft: isStart ? 4 : 2,
                  paddingRight: 2,
                }}
                className="flex items-center overflow-hidden"
              >
                <span className="text-white text-[10px] truncate leading-none">
                  {isStart && (
                    <span className="mr-0.5 font-medium">{color.label}</span>
                  )}
                  {bar.event.title}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Day cells */}
      <div className="grid grid-cols-7 divide-x divide-zinc-100 flex-1 min-h-0">
        {days.map((day, colIndex) => (
          <CalendarCell
            key={day.dateStr}
            day={day}
            dayOfWeek={colIndex}
            chips={dayChips.get(day.dateStr) ?? []}
            onPress={() => onDayPress(day.dateStr)}
          />
        ))}
      </div>
    </div>
  );
}
