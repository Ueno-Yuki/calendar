'use client';

import type { Event } from '@/types';

interface Props {
  event: Event;
  onCancel: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
}

function formatDateTime(date: string, time: string): string {
  const [y, m, d] = date.split('-');
  const base = `${y}年${Number(m)}月${Number(d)}日`;
  return time ? `${base} ${time}` : base;
}

export default function DeleteConfirmModal({ event, onCancel, onConfirm, isDeleting }: Props) {
  const startLabel = formatDateTime(event.start_date, event.all_day ? '' : event.start_time);
  const endLabel = formatDateTime(event.end_date, event.all_day ? '' : event.end_time);

  return (
    <>
      {/* Backdrop (above DayModal sheet) */}
      <div
        className="fixed inset-0 bg-black/60"
        style={{ zIndex: 60 }}
        onClick={onCancel}
        aria-hidden="true"
      />
      {/* Dialog */}
      <div
        className="fixed inset-x-6 bg-white rounded-2xl p-5"
        style={{ zIndex: 70, top: '50%', transform: 'translateY(-50%)' }}
        role="alertdialog"
        aria-modal="true"
      >
        <h3 className="text-base font-semibold text-zinc-900 text-center mb-4">
          この予定を削除しますか？
        </h3>

        {/* Event summary */}
        <div className="bg-zinc-50 rounded-xl px-4 py-3 mb-5 space-y-1.5">
          <p className="text-sm font-semibold text-zinc-900">{event.title}</p>
          <p className="text-xs text-zinc-500">
            {startLabel}
            {' 〜 '}
            {endLabel}
          </p>
          {event.location && (
            <p className="text-xs text-zinc-500">📍 {event.location}</p>
          )}
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="flex-1 py-2.5 rounded-xl border border-zinc-200 text-sm text-zinc-600 font-medium disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex-1 py-2.5 rounded-xl bg-red-500 text-sm text-white font-semibold disabled:opacity-50"
          >
            {isDeleting ? '削除中…' : 'OK'}
          </button>
        </div>
      </div>
    </>
  );
}
