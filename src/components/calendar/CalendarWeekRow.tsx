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
  const todayCol = days.findIndex((d) => d.isToday);

  return (
    <div className="border-b border-zinc-100 flex-1 flex flex-col min-h-0">

      {/* 段1: 日付数字行 — 常に最上部。バーより先に描画し重ならない */}
      <div className="grid grid-cols-7 divide-x divide-zinc-100 shrink-0">
        {days.map((day, colIndex) => {
          const dow = colIndex; // 0=日, 6=土
          const dayNum = day.date.getDate();
          let numClass = 'text-zinc-900';
          if (!day.isCurrentMonth) {
            numClass = 'text-zinc-300';
          } else if (dow === 0 || day.holidayName) {
            numClass = 'text-red-500';
          } else if (dow === 6) {
            numClass = 'text-blue-500';
          }

          return (
            <button
              key={day.dateStr}
              type="button"
              onClick={() => onDayPress(day.dateStr)}
              className={`flex flex-col items-center w-full pt-0.5 pb-0 focus:outline-none ${day.isToday ? 'bg-slate-100' : ''}`}
            >
              <span
                className={`text-xs font-medium leading-5 w-5 h-5 flex items-center justify-center rounded-full ${
                  day.isToday ? 'bg-zinc-800 text-white' : numClass
                }`}
              >
                {dayNum}
              </span>
              {day.holidayName && day.isCurrentMonth && (
                <span className="text-[8px] text-red-500 leading-3 w-full text-center truncate px-px">
                  {day.holidayName}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 段2: 複数日予定バー — 日付行の直下 */}
      {totalBarRows > 0 && (
        <div className="relative shrink-0" style={{ height: barSectionHeight }}>
          {/* 今日列の背景 (バーより前に描画してz-indexで後ろに) */}
          {todayCol >= 0 && (
            <div
              className="absolute inset-y-0 bg-slate-100"
              style={{
                left: `${(todayCol / 7) * 100}%`,
                width: `${(1 / 7) * 100}%`,
              }}
            />
          )}
          {multiDayBars.map((bar, i) => {
            const leftPct = `${(bar.startCol / 7) * 100}%`;
            const widthPct = `${((bar.endCol - bar.startCol + 1) / 7) * 100}%`;
            const top = bar.barRow * (BAR_HEIGHT + BAR_GAP);
            const color = FAMILY_COLORS[bar.event.person];
            const isStart =
              bar.startCol === days.findIndex((d) => d.dateStr === bar.event.start_date);
            const isEnd =
              bar.endCol === days.findIndex((d) => d.dateStr === bar.event.end_date);
            return (
              <button
                key={`${bar.event.id}-${i}`}
                type="button"
                onClick={() => onDayPress(days[bar.startCol]?.dateStr ?? bar.event.start_date)}
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
                className="flex items-center overflow-hidden focus:outline-none"
              >
                <span className="text-white text-[10px] truncate leading-none">
                  {bar.event.title}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* 段3: 単日予定チップ行 — 複数日予定は含まない（バーで表示済み） */}
      <div className="grid grid-cols-7 divide-x divide-zinc-100 flex-1 min-h-0">
        {days.map((day) => (
          <CalendarCell
            key={day.dateStr}
            chips={dayChips.get(day.dateStr) ?? []}
            isToday={day.isToday}
            onPress={() => onDayPress(day.dateStr)}
          />
        ))}
      </div>

    </div>
  );
}
