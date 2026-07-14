'use client';

import { X } from 'lucide-react';

export interface GoogleReverseCreateCandidate {
  sheetEventId: string;
  title: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  suggestedColorId: string;
}

export interface GoogleReverseUpdateCandidate {
  sheetEventId: string;
  googleEventId: string;
  startDate: string;
  appTitle: string;
  googleTitle: string;
  suggestedColorId: string;
}

export interface GoogleReverseSkippedItem {
  sheetEventId: string;
  title: string;
  startDate: string;
  reason: string;
}

export interface GoogleReverseSyncPreview {
  ok: true;
  timeMin: string;
  timeMax: string;
  createCandidates: GoogleReverseCreateCandidate[];
  updateCandidates: GoogleReverseUpdateCandidate[];
  skipped: GoogleReverseSkippedItem[];
}

interface Props {
  preview: GoogleReverseSyncPreview;
  selectedCreateIds: string[];
  selectedUpdatePairKeys: string[];
  selectedCreateColorIds: Record<string, string>;
  selectedUpdateColorIds: Record<string, string>;
  syncing: boolean;
  error?: string;
  onToggleCreate: (sheetEventId: string) => void;
  onToggleUpdate: (pair: GoogleReverseUpdateCandidate) => void;
  onCreateColorChange: (sheetEventId: string, colorId: string) => void;
  onUpdateColorChange: (pairKey: string, colorId: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}

const REVERSE_SYNC_CATEGORY_OPTIONS = [
  { value: 'default', label: 'サロン' },
  { value: '10', label: '誕生日' },
  { value: '11', label: '個人の予定' },
  { value: '5', label: 'かっぱ' },
] as const;

function formatDateTime(event: GoogleReverseCreateCandidate): string {
  const date = event.startDate.replaceAll('-', '/');
  if (event.allDay || !event.startTime) return date;
  return `${date} ${event.startTime}`;
}

function formatRangeLabel(timeMin: string, timeMax: string): string {
  const start = new Date(timeMin);
  const end = new Date(timeMax);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${timeMin} 〜 ${timeMax}`;
  }
  const fmt = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const startText = fmt.format(start).replaceAll('/', '/');
  const endText = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(end.getTime() - 1));
  return `${startText} 〜 ${endText}`;
}

function pairKey(pair: GoogleReverseUpdateCandidate): string {
  return `${pair.sheetEventId}::${pair.googleEventId}`;
}

export default function GoogleReverseSyncPreviewModal({
  preview,
  selectedCreateIds,
  selectedUpdatePairKeys,
  selectedCreateColorIds,
  selectedUpdateColorIds,
  syncing,
  error,
  onToggleCreate,
  onToggleUpdate,
  onCreateColorChange,
  onUpdateColorChange,
  onClose,
  onConfirm,
}: Props) {
  const selectedCount = selectedCreateIds.length + selectedUpdatePairKeys.length;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={syncing ? undefined : onClose} aria-hidden="true" />
      <div
        className="fixed inset-x-3 top-8 z-50 mx-auto flex max-h-[calc(100dvh-4rem)] max-w-md flex-col rounded-2xl bg-white shadow-xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">Googleへ反映</h2>
            <p className="mt-1 text-xs text-zinc-500">反映する予定を選択してください</p>
          </div>
          <button
            type="button"
            aria-label="閉じる"
            onClick={onClose}
            disabled={syncing}
            className="p-1 text-zinc-400 hover:text-zinc-600 disabled:opacity-40"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          <div className="rounded-xl bg-zinc-50 px-3 py-2">
            <p className="text-xs text-zinc-400">対象期間</p>
            <p className="mt-1 text-sm font-medium text-zinc-800">
              {formatRangeLabel(preview.timeMin, preview.timeMax)}
            </p>
          </div>

          <section>
            <p className="mb-2 text-sm font-semibold text-zinc-900">
              新規登録候補 {preview.createCandidates.length}件
            </p>
            <div className="space-y-2">
              {preview.createCandidates.length === 0 && (
                <p className="rounded-xl bg-zinc-50 px-3 py-3 text-xs text-zinc-400">候補はありません</p>
              )}
              {preview.createCandidates.map((event) => (
                <label
                  key={event.sheetEventId}
                  className="flex items-start gap-3 rounded-xl border border-zinc-100 px-3 py-2 active:bg-zinc-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedCreateIds.includes(event.sheetEventId)}
                    onChange={() => onToggleCreate(event.sheetEventId)}
                    disabled={syncing}
                    className="mt-1 h-4 w-4 shrink-0 accent-zinc-900"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-zinc-800">{event.title}</span>
                    <span className="block text-xs text-zinc-400">{formatDateTime(event)}</span>
                    <span className="mt-2 block">
                      <span className="mb-1 block text-[11px] text-zinc-400">カテゴリ</span>
                      <select
                        value={selectedCreateColorIds[event.sheetEventId] ?? event.suggestedColorId}
                        onChange={(e) => onCreateColorChange(event.sheetEventId, e.target.value)}
                        disabled={syncing}
                        className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-sm text-zinc-700"
                      >
                        {REVERSE_SYNC_CATEGORY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section>
            <p className="mb-2 text-sm font-semibold text-zinc-900">
              更新候補 {preview.updateCandidates.length}件
            </p>
            <div className="space-y-2">
              {preview.updateCandidates.length === 0 && (
                <p className="rounded-xl bg-zinc-50 px-3 py-3 text-xs text-zinc-400">候補はありません</p>
              )}
              {preview.updateCandidates.map((pair) => {
                const key = pairKey(pair);
                return (
                  <label
                    key={key}
                    className="flex items-start gap-3 rounded-xl border border-zinc-100 px-3 py-2 active:bg-zinc-50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedUpdatePairKeys.includes(key)}
                      onChange={() => onToggleUpdate(pair)}
                      disabled={syncing}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-zinc-900"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs text-zinc-400">{pair.startDate.replaceAll('-', '/')}</span>
                      <span className="block truncate text-sm text-zinc-500">Google: {pair.googleTitle}</span>
                      <span className="block truncate text-sm font-medium text-zinc-800">アプリ: {pair.appTitle}</span>
                      <span className="mt-2 block">
                        <span className="mb-1 block text-[11px] text-zinc-400">カテゴリ</span>
                        <select
                          value={selectedUpdateColorIds[key] ?? pair.suggestedColorId}
                          onChange={(e) => onUpdateColorChange(key, e.target.value)}
                          disabled={syncing}
                          className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-sm text-zinc-700"
                        >
                          {REVERSE_SYNC_CATEGORY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>
        </div>

        <div className="border-t border-zinc-100 px-4 py-3">
          {error && <p className="mb-2 text-xs text-red-500">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={syncing}
              className="rounded-xl px-4 py-2 text-sm font-medium text-zinc-500 active:bg-zinc-50 disabled:opacity-50"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={syncing || selectedCount === 0}
              className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-zinc-200 disabled:text-zinc-400"
            >
              {syncing ? '反映中...' : 'Googleへ反映'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export function googleReversePairKey(pair: GoogleReverseUpdateCandidate): string {
  return pairKey(pair);
}
