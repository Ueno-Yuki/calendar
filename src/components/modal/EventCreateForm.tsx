'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/apiClient';

const HOUR_LIST = Array.from({ length: 24 }, (_, i) => i);
const MINUTE_LIST = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function roundTo5Min(date: Date): { hour: number; minute: number } {
  const m = date.getMinutes();
  const rounded = Math.ceil(m / 5) * 5;
  if (rounded >= 60) return { hour: (date.getHours() + 1) % 24, minute: 0 };
  return { hour: date.getHours(), minute: rounded };
}

interface Props {
  dateStr: string;
  onSaved: () => void;
  onCancel: () => void;
}

export default function EventCreateForm({ dateStr, onSaved, onCancel }: Props) {
  const now = new Date();
  const { hour: initHour, minute: initMin } = roundTo5Min(now);
  const initEndHour = (initHour + 1) % 24;

  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState(dateStr);
  const [endDate, setEndDate] = useState(dateStr);
  const [allDay, setAllDay] = useState(false);
  const [startHour, setStartHour] = useState(initHour);
  const [startMinute, setStartMinute] = useState(initMin);
  const [hasEndTime, setHasEndTime] = useState(true);
  const [endHour, setEndHour] = useState(initEndHour);
  const [endMinute, setEndMinute] = useState(initMin);
  const [location, setLocation] = useState('');
  const [memo, setMemo] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const validate = (): string[] => {
    const errs: string[] = [];
    if (!title.trim()) errs.push('タイトルを入力してください');
    if (!startDate) errs.push('開始日を入力してください');
    if (!endDate) errs.push('終了日を入力してください');
    if (startDate && endDate && endDate < startDate)
      errs.push('終了日は開始日以降を指定してください');
    if (!allDay && hasEndTime && startDate === endDate) {
      if (endHour * 60 + endMinute < startHour * 60 + startMinute)
        errs.push('終了時間は開始時間より後を指定してください');
    }
    return errs;
  };

  const handleSave = async () => {
    const errs = validate();
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    setErrors([]);
    setSubmitting(true);
    try {
      const body = {
        title: title.trim(),
        start_date: startDate,
        end_date: endDate,
        all_day: allDay,
        start_time: allDay ? '' : `${pad2(startHour)}:${pad2(startMinute)}`,
        end_time: allDay || !hasEndTime ? '' : `${pad2(endHour)}:${pad2(endMinute)}`,
        location,
        memo,
      };
      const res = await apiFetch('/api/events', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setErrors([data.error ?? '登録に失敗しました']);
        return;
      }
      onSaved();
    } catch {
      setErrors(['通信エラーが発生しました']);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartDateChange = (val: string) => {
    setStartDate(val);
    if (endDate < val) setEndDate(val);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Form header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 shrink-0">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="text-sm text-zinc-500 hover:text-zinc-700 px-1"
        >
          キャンセル
        </button>
        <h2 className="text-base font-semibold text-zinc-900">予定を登録</h2>
        <button
          type="button"
          onClick={handleSave}
          disabled={submitting}
          className="text-sm font-semibold text-zinc-900 hover:text-zinc-600 disabled:opacity-50 px-1"
        >
          {submitting ? '保存中…' : '保存'}
        </button>
      </div>

      {/* Scrollable form body */}
      <div className="overflow-y-auto flex-1 px-4 py-4 flex flex-col gap-5 pb-8">
        {/* Errors */}
        {errors.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
            {errors.map((e, i) => (
              <p key={i} className="text-sm text-red-600 leading-5">
                {e}
              </p>
            ))}
          </div>
        )}

        {/* Title */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-500">
            タイトル <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="予定のタイトル"
            className="border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-300"
          />
        </div>

        {/* All-day toggle */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-700">終日</span>
          <button
            type="button"
            role="switch"
            aria-checked={allDay}
            onClick={() => setAllDay((v) => !v)}
            className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${
              allDay ? 'bg-zinc-800' : 'bg-zinc-200'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                allDay ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Dates */}
        <div className="flex gap-3">
          <div className="flex-1 flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-500">
              開始日 <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => handleStartDateChange(e.target.value)}
              className="border border-zinc-200 rounded-xl px-2.5 py-2.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-300 w-full"
            />
          </div>
          <div className="flex-1 flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-500">
              終了日 <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="border border-zinc-200 rounded-xl px-2.5 py-2.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-300 w-full"
            />
          </div>
        </div>

        {/* Time inputs (hidden when all-day) */}
        {!allDay && (
          <>
            {/* Start time */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-500">
                開始時間 <span className="text-red-500">*</span>
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={startHour}
                  onChange={(e) => setStartHour(Number(e.target.value))}
                  className="border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-300 bg-white"
                >
                  {HOUR_LIST.map((h) => (
                    <option key={h} value={h}>
                      {pad2(h)}
                    </option>
                  ))}
                </select>
                <span className="text-zinc-400 font-medium">:</span>
                <select
                  value={startMinute}
                  onChange={(e) => setStartMinute(Number(e.target.value))}
                  className="border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-300 bg-white"
                >
                  {MINUTE_LIST.map((m) => (
                    <option key={m} value={m}>
                      {pad2(m)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* End time */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-500">終了時間</label>
              {hasEndTime ? (
                <div className="flex items-center gap-2">
                  <select
                    value={endHour}
                    onChange={(e) => setEndHour(Number(e.target.value))}
                    className="border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-300 bg-white"
                  >
                    {HOUR_LIST.map((h) => (
                      <option key={h} value={h}>
                        {pad2(h)}
                      </option>
                    ))}
                  </select>
                  <span className="text-zinc-400 font-medium">:</span>
                  <select
                    value={endMinute}
                    onChange={(e) => setEndMinute(Number(e.target.value))}
                    className="border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-300 bg-white"
                  >
                    {MINUTE_LIST.map((m) => (
                      <option key={m} value={m}>
                        {pad2(m)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setHasEndTime(false)}
                    aria-label="終了時間を削除"
                    className="ml-1 text-zinc-400 hover:text-zinc-600 text-lg leading-none"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setHasEndTime(true)}
                  className="self-start text-sm text-zinc-400 hover:text-zinc-600 border border-dashed border-zinc-300 rounded-xl px-4 py-2"
                >
                  + 追加
                </button>
              )}
            </div>
          </>
        )}

        {/* Location */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-500">場所</label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="場所を入力"
            className="border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-300"
          />
        </div>

        {/* Memo */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-500">メモ</label>
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="メモを入力"
            rows={3}
            className="border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-300 resize-none"
          />
        </div>
      </div>
    </div>
  );
}
