'use client';

import { useMemo, useRef } from 'react';
import type { Event } from '@/types';
import { buildCalendarWeeks } from '@/lib/calendarUtils';
import { getHolidaysForMonth } from '@/lib/holidays';
import CalendarWeekRow from './CalendarWeekRow';

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const SWIPE_THRESHOLD = 50;

interface Props {
  year: number;
  month: number;
  events: Event[];
  loading: boolean;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onDayPress: (dateStr: string) => void;
}

export default function CalendarGrid({
  year,
  month,
  events,
  loading,
  onPrevMonth,
  onNextMonth,
  onDayPress,
}: Props) {
  const touchStartX = useRef<number | null>(null);

  const holidays = useMemo(() => getHolidaysForMonth(year, month), [year, month]);
  const weeks = useMemo(
    () => buildCalendarWeeks(year, month, events, holidays),
    [year, month, events, holidays],
  );

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (dx > SWIPE_THRESHOLD) onPrevMonth();
    else if (dx < -SWIPE_THRESHOLD) onNextMonth();
  };

  return (
    <div
      className="flex flex-col flex-1 min-h-0 select-none relative"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Day-of-week header */}
      <div className="grid grid-cols-7 border-b border-zinc-200 shrink-0">
        {DOW_LABELS.map((label, i) => (
          <div
            key={label}
            className={`py-1 text-center text-xs font-medium ${
              i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-zinc-400'
            }`}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Week rows */}
      <div className="flex flex-col flex-1 min-h-0">
        {weeks.map((week, i) => (
          <CalendarWeekRow key={i} weekData={week} onDayPress={onDayPress} />
        ))}
      </div>

      {/* Initial load overlay only */}
      {loading && (
        <div className="absolute inset-0 bg-white/60 flex items-center justify-center z-10">
          <span className="text-sm text-zinc-400">読み込み中…</span>
        </div>
      )}
    </div>
  );
}
