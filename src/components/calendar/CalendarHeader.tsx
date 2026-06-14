'use client';

import { Settings } from 'lucide-react';

interface Props {
  year: number;
  month: number;
  syncing?: boolean;
  onSettingsOpen?: () => void;
  onYearMonthPress?: () => void;
}

export default function CalendarHeader({ year, month, syncing, onSettingsOpen, onYearMonthPress }: Props) {
  return (
    <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-zinc-200 shrink-0">
      <button
        type="button"
        onClick={onYearMonthPress}
        aria-label={`${year}年${month}月、タップして年月を変更`}
        className="text-lg font-semibold text-zinc-900 active:opacity-60"
      >
        {year}年{month}月
      </button>
      <div className="flex items-center gap-2">
        {syncing && (
          <span className="text-xs text-zinc-400 animate-pulse">更新中…</span>
        )}
        <button
          type="button"
          aria-label="設定"
          onClick={onSettingsOpen}
          className="p-2 text-zinc-400 hover:text-zinc-600"
        >
          <Settings size={20} />
        </button>
      </div>
    </header>
  );
}
