'use client';

import { X } from 'lucide-react';

interface Props {
  loading?: boolean;
  connected?: boolean;
  reauthRequired?: boolean;
  syncDisabled?: boolean;
  error?: string;
  onClose: () => void;
  onImport: () => void;
  onReverse: () => void;
  onReconnect: () => void;
}

export default function GoogleSyncModeModal({
  loading = false,
  connected = true,
  reauthRequired = false,
  syncDisabled = false,
  error = '',
  onClose,
  onImport,
  onReverse,
  onReconnect,
}: Props) {
  const actionsDisabled = loading || syncDisabled || !connected || reauthRequired;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={loading ? undefined : onClose}
        aria-hidden="true"
      />
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
          {syncDisabled && (
            <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-3">
              <p className="text-sm font-medium text-amber-700">Google同期は停止中です</p>
            </div>
          )}

          {reauthRequired && (
            <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-3">
              <p className="text-sm font-medium text-red-600">
                Google連携の有効期限が切れています。再連携してください。
              </p>
              <button
                type="button"
                onClick={onReconnect}
                disabled={loading}
                className="mt-3 rounded-xl bg-white px-3 py-2 text-sm font-medium text-red-600 ring-1 ring-red-200 disabled:opacity-50"
              >
                Googleカレンダーを再連携
              </button>
            </div>
          )}

          {!reauthRequired && !connected && !syncDisabled && (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3">
              <p className="text-sm font-medium text-zinc-700">Googleカレンダーと連携されていません</p>
              <button
                type="button"
                onClick={onReconnect}
                disabled={loading}
                className="mt-3 rounded-xl bg-white px-3 py-2 text-sm font-medium text-zinc-700 ring-1 ring-zinc-200 disabled:opacity-50"
              >
                Googleカレンダーを連携
              </button>
            </div>
          )}

          {error && (
            <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm font-medium text-red-600">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={onImport}
            disabled={actionsDisabled}
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
            disabled={actionsDisabled}
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
