'use client';

import { X } from 'lucide-react';

export interface GoogleSyncColorGroup {
  colorId: string;
  label: string;
  count: number;
  samples: string[];
}

export interface GoogleSyncPreview {
  ok: true;
  timeMin: string;
  timeMax: string;
  totalFetched: number;
  validEvents: number;
  cancelled: number;
  colorGroups: GoogleSyncColorGroup[];
}

interface Props {
  preview: GoogleSyncPreview;
  selectedColorIds: string[];
  syncing: boolean;
  error: string;
  onToggleColor: (colorId: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}/${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}/${get('month')}/${get('day')}`;
}

function formatExclusiveEndDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatDate(new Date(date.getTime() - 1).toISOString());
}

export default function GoogleSyncPreviewModal({
  preview,
  selectedColorIds,
  syncing,
  error,
  onToggleColor,
  onClose,
  onConfirm,
}: Props) {
  const selectedSet = new Set(selectedColorIds);
  const canConfirm = selectedColorIds.length > 0 && !syncing;

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/40"
        onClick={syncing ? undefined : onClose}
        aria-hidden="true"
      />
      <div className="fixed inset-x-4 top-1/2 z-50 max-h-[82dvh] -translate-y-1/2 overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-4">
          <h2 className="text-base font-semibold text-zinc-900">Googleカレンダー同期</h2>
          <button
            type="button"
            aria-label="閉じる"
            onClick={onClose}
            disabled={syncing}
            className="p-1 text-zinc-400 disabled:opacity-40"
          >
            <X size={20} />
          </button>
        </div>

        <div className="max-h-[60dvh] overflow-y-auto px-4 py-4">
          <p className="text-sm text-zinc-700">取り込む予定を選択してください</p>

          <div className="mt-4 space-y-1 text-sm">
            <p className="text-zinc-500">対象期間:</p>
            <p className="font-medium text-zinc-800">
              {formatDateTime(preview.timeMin)} 〜 {formatExclusiveEndDate(preview.timeMax)}
            </p>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-zinc-50 px-2 py-2">
              <p className="text-[11px] text-zinc-400">取得予定</p>
              <p className="text-sm font-semibold text-zinc-800">{preview.validEvents}件</p>
            </div>
            <div className="rounded-lg bg-zinc-50 px-2 py-2">
              <p className="text-[11px] text-zinc-400">取得総数</p>
              <p className="text-sm font-semibold text-zinc-800">{preview.totalFetched}件</p>
            </div>
            <div className="rounded-lg bg-zinc-50 px-2 py-2">
              <p className="text-[11px] text-zinc-400">削除済み</p>
              <p className="text-sm font-semibold text-zinc-800">{preview.cancelled}件</p>
            </div>
          </div>

          <div className="mt-4 divide-y divide-zinc-100 rounded-xl border border-zinc-100">
            {preview.colorGroups.length === 0 ? (
              <p className="px-4 py-5 text-center text-sm text-zinc-400">取り込み候補がありません</p>
            ) : (
              preview.colorGroups.map((group) => (
                <label
                  key={group.colorId}
                  className="flex items-start gap-3 px-4 py-3 active:bg-zinc-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedSet.has(group.colorId)}
                    onChange={() => onToggleColor(group.colorId)}
                    disabled={syncing}
                    className="mt-1 h-4 w-4 rounded border-zinc-300 text-zinc-900"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-zinc-800">
                      {group.label} {group.count}件
                    </span>
                    {group.samples.length > 0 && (
                      <span className="mt-1 block truncate text-xs text-zinc-400">
                        例: {group.samples.join('、')}
                      </span>
                    )}
                  </span>
                </label>
              ))
            )}
          </div>

          {error && (
            <p className="mt-3 text-xs font-medium text-red-500">{error}</p>
          )}
        </div>

        <div className="flex gap-2 border-t border-zinc-100 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={syncing}
            className="h-10 flex-1 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-600 disabled:opacity-40"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className="h-10 flex-1 rounded-xl bg-zinc-900 text-sm font-semibold text-white disabled:bg-zinc-200 disabled:text-zinc-400"
          >
            {syncing ? '同期中...' : '同期する'}
          </button>
        </div>
      </div>
    </>
  );
}
