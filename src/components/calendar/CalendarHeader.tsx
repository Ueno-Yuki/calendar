'use client';

import { Settings } from 'lucide-react';

interface Props {
  year: number;
  month: number;
  syncing?: boolean;
}

export default function CalendarHeader({ year, month, syncing }: Props) {
  return (
    <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-zinc-200 shrink-0">
      <h1 className="text-lg font-semibold text-zinc-900">
        {year}年{month}月
      </h1>
      <div className="flex items-center gap-2">
        {syncing && (
          <span className="text-xs text-zinc-400 animate-pulse">更新中…</span>
        )}
        <button type="button" aria-label="設定" className="p-2 text-zinc-400 hover:text-zinc-600">
          <Settings size={20} />
        </button>
      </div>
    </header>
  );
}
