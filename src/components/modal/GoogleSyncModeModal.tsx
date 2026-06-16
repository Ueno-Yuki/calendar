'use client';

import { X } from 'lucide-react';

interface Props {
  loading?: boolean;
  onClose: () => void;
  onImport: () => void;
  onReverse: () => void;
}

export default function GoogleSyncModeModal({
  loading = false,
  onClose,
  onImport,
  onReverse,
}: Props) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-x-4 top-1/2 z-50 mx-auto max-w-sm -translate-y-1/2 rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-4">
          <h2 className="text-base font-semibold text-zinc-900">Googleカレンダー同期</h2>
          <button
            type="button"
            aria-label="閉じる"
            onClick={onClose}
            disabled={loading}
            className="p-1 text-zinc-400 hover:text-zinc-600 disabled:opacity-40"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          <button
            type="button"
            onClick={onImport}
            disabled={loading}
            className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left active:bg-zinc-50 disabled:opacity-50"
          >
            <p className="text-sm font-semibold text-zinc-900">Googleカレンダーから取り込む</p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              Googleカレンダーの予定を家族カレンダーへ取り込みます
            </p>
          </button>

          <button
            type="button"
            onClick={onReverse}
            disabled={loading}
            className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left active:bg-zinc-50 disabled:opacity-50"
          >
            <p className="text-sm font-semibold text-zinc-900">アプリの予定をGoogleへ反映</p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              家族カレンダーにある予定をGoogleカレンダーへ登録します
            </p>
          </button>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-xl px-4 py-2 text-sm font-medium text-zinc-500 active:bg-zinc-50 disabled:opacity-50"
          >
            キャンセル
          </button>
        </div>
      </div>
    </>
  );
}
