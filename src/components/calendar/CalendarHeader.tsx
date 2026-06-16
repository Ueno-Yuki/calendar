'use client';

import { RefreshCw, Settings } from 'lucide-react';

interface Props {
  year: number;
  month: number;
  syncing?: boolean;
  hasRemoteUpdates?: boolean;
  isRefreshing?: boolean;
  refreshDisabled?: boolean;
  onRefresh?: () => void;
  onSettingsOpen?: () => void;
  onYearMonthPress?: () => void;
}

export default function CalendarHeader({
  year,
  month,
  syncing,
  hasRemoteUpdates = false,
  isRefreshing = false,
  refreshDisabled = false,
  onRefresh,
  onSettingsOpen,
  onYearMonthPress,
}: Props) {
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
          aria-label="予定を更新"
          onClick={onRefresh}
          disabled={refreshDisabled || isRefreshing}
          className="relative p-2 text-zinc-400 hover:text-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RefreshCw size={20} className={isRefreshing ? 'animate-spin' : ''} />
          {hasRemoteUpdates && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
              i
            </span>
          )}
        </button>
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
