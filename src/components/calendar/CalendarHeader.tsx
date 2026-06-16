'use client';

import { RefreshCw, Settings } from 'lucide-react';
import GoogleSyncIcon from '@/components/icons/GoogleSyncIcon';

interface Props {
  year: number;
  month: number;
  syncing?: boolean;
  hasRemoteUpdates?: boolean;
  isRefreshing?: boolean;
  refreshDisabled?: boolean;
  showGoogleSync?: boolean;
  isGoogleSyncing?: boolean;
  googleSyncDisabled?: boolean;
  onRefresh?: () => void;
  onGoogleSync?: () => void;
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
  showGoogleSync = false,
  isGoogleSyncing = false,
  googleSyncDisabled = false,
  onRefresh,
  onGoogleSync,
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
        {showGoogleSync && (
          <button
            type="button"
            aria-label="Googleカレンダー同期"
            onClick={onGoogleSync}
            disabled={googleSyncDisabled || isGoogleSyncing}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 text-sm font-semibold text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <GoogleSyncIcon className={isGoogleSyncing ? 'animate-pulse' : ''} />
          </button>
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
