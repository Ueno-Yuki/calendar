'use client';

import { useMemo, useRef } from 'react';
import type { Event } from '@/types';
import { buildCalendarWeeks } from '@/lib/calendarUtils';
import { getHolidaysForMonth } from '@/lib/holidays';
import CalendarWeekRow from './CalendarWeekRow';

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const SWIPE_THRESHOLD = 50;
const PULL_REFRESH_THRESHOLD = 60;

interface Props {
  year: number;
  month: number;
  events: Event[];
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onRefresh: () => void;
  refreshDisabled?: boolean;
  onDayPress: (dateStr: string) => void;
}

export default function CalendarGrid({
  year,
  month,
  events,
  onPrevMonth,
  onNextMonth,
  onRefresh,
  refreshDisabled = false,
  onDayPress,
}: Props) {
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const holidays = useMemo(() => getHolidaysForMonth(year, month), [year, month]);
  const weeks = useMemo(
    () => buildCalendarWeeks(year, month, events, holidays),
    [year, month, events, holidays],
  );

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    touchStartX.current = null;
    touchStartY.current = null;

    if (absDx > absDy) {
      if (dx > SWIPE_THRESHOLD) onPrevMonth();
      else if (dx < -SWIPE_THRESHOLD) onNextMonth();
      return;
    }

    if (!refreshDisabled && absDy > absDx && dy > PULL_REFRESH_THRESHOLD) {
      onRefresh();
    }
  };

  return (
    <div
      className="flex flex-col flex-1 min-h-0 select-none relative"
      style={{ touchAction: 'pan-y' }}
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
    </div>
  );
}
