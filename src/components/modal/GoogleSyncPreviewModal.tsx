'use client';

import { ChevronDown, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

export interface GoogleSyncPreviewEvent {
  googleEventId: string;
  title: string;
  start: string;
  end: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  colorId: string;
}

export interface GoogleSyncCategory {
  categoryId: string;
  label: string;
  icon: string;
  colorIds: string[];
  count: number;
  alreadyImported: number;
  selectableCount: number;
  events: GoogleSyncPreviewEvent[];
}

export interface GoogleSyncPreview {
  ok: true;
  timeMin: string;
  timeMax: string;
  totalFetched: number;
  validEvents: number;
  cancelled: number;
  alreadyImported: number;
  selectable: number;
  categories: GoogleSyncCategory[];
}

interface Props {
  preview: GoogleSyncPreview;
  selectedEventIds: string[];
  expandedCategoryIds: string[];
  syncing: boolean;
  error: string;
  onToggleCategory: (categoryId: string) => void;
  onToggleCategoryExpanded: (categoryId: string) => void;
  onToggleEvent: (googleEventId: string) => void;
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

function formatEventDate(event: GoogleSyncPreviewEvent): string {
  const start = formatDate(event.start);
  const end = formatDate(event.end);
  if (event.start !== event.end) return `${start}〜${end}`;
  if (event.allDay) return start;
  return `${start} ${event.startTime}${event.endTime ? `〜${event.endTime}` : ''}`;
}

function CategoryCheckbox({
  checked,
  indeterminate,
  disabled,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      onClick={(event) => event.stopPropagation()}
      disabled={disabled}
      className="mt-1 h-4 w-4 rounded border-zinc-300 text-zinc-900"
    />
  );
}

export default function GoogleSyncPreviewModal({
  preview,
  selectedEventIds,
  expandedCategoryIds,
  syncing,
  error,
  onToggleCategory,
  onToggleCategoryExpanded,
  onToggleEvent,
  onClose,
  onConfirm,
}: Props) {
  const selectedSet = new Set(selectedEventIds);
  const expandedSet = new Set(expandedCategoryIds);
  const canConfirm = selectedEventIds.length > 0 && !syncing;

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
              <p className="text-sm font-semibold text-zinc-800">{preview.selectable}件</p>
            </div>
            <div className="rounded-lg bg-zinc-50 px-2 py-2">
              <p className="text-[11px] text-zinc-400">選択中</p>
              <p className="text-sm font-semibold text-zinc-800">{selectedEventIds.length}件</p>
            </div>
            <div className="rounded-lg bg-zinc-50 px-2 py-2">
              <p className="text-[11px] text-zinc-400">削除済み</p>
              <p className="text-sm font-semibold text-zinc-800">{preview.cancelled}件</p>
            </div>
          </div>

          {preview.alreadyImported > 0 && (
            <p className="mt-3 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
              取り込み済みの予定 {preview.alreadyImported}件を除外しました
            </p>
          )}

          <div className="mt-4 divide-y divide-zinc-100 rounded-xl border border-zinc-100">
            {preview.categories.length === 0 ? (
              <p className="px-4 py-5 text-center text-sm text-zinc-400">取り込み候補がありません</p>
            ) : (
              preview.categories.map((category) => {
                const categoryEventIds = category.events.map((event) => event.googleEventId);
                const selectedCount = categoryEventIds.filter((id) => selectedSet.has(id)).length;
                const checked = selectedCount === categoryEventIds.length && categoryEventIds.length > 0;
                const indeterminate = selectedCount > 0 && selectedCount < categoryEventIds.length;
                const expanded = expandedSet.has(category.categoryId);
                const samples = category.events.slice(0, 3).map((event) => event.title);

                return (
                  <div key={category.categoryId}>
                    <div className="flex items-start gap-3 px-4 py-3 active:bg-zinc-50">
                      <CategoryCheckbox
                        checked={checked}
                        indeterminate={indeterminate}
                        disabled={syncing}
                        onChange={() => onToggleCategory(category.categoryId)}
                      />
                      <button
                        type="button"
                        onClick={() => onToggleCategoryExpanded(category.categoryId)}
                        disabled={syncing}
                        className="flex min-w-0 flex-1 items-start gap-2 text-left disabled:opacity-60"
                      >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-zinc-800">
                          {category.icon && <span className="mr-1">{category.icon}</span>}
                          {category.label} {category.selectableCount}件
                        </span>
                        {category.alreadyImported > 0 && (
                          <span className="mt-1 block text-xs text-zinc-400">
                            取り込み済み {category.alreadyImported}件を除外
                          </span>
                        )}
                        {samples.length > 0 && !expanded && (
                          <span className="mt-1 block truncate text-xs text-zinc-400">
                            例: {samples.join('、')}
                          </span>
                        )}
                      </span>
                      <ChevronDown
                        size={16}
                        className={`mt-1 shrink-0 text-zinc-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
                      />
                      </button>
                    </div>

                    {expanded && (
                      <div className="space-y-1 bg-zinc-50 px-4 pb-3 pl-11">
                        {category.events.map((event) => (
                          <label
                            key={event.googleEventId}
                            className="flex items-center gap-2 rounded-lg px-2 py-2 active:bg-white"
                          >
                            <input
                              type="checkbox"
                              checked={selectedSet.has(event.googleEventId)}
                              onChange={() => onToggleEvent(event.googleEventId)}
                              disabled={syncing}
                              className="h-4 w-4 rounded border-zinc-300 text-zinc-900"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm text-zinc-700">{event.title}</span>
                              <span className="block text-xs text-zinc-400">{formatEventDate(event)}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
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
