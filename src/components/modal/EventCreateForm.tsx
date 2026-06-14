'use client';

import { useState, useEffect } from 'react';
import type { EventTemplate, FamilyRole } from '@/types';
import { apiFetch } from '@/lib/apiClient';
import { STORAGE_KEY } from '@/lib/auth';
import type { StoredUser } from '@/lib/auth';
import { FAMILY_COLORS } from '@/lib/colors';

const HOUR_LIST = Array.from({ length: 24 }, (_, i) => i);
const MINUTE_LIST = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function roundTo5Min(date: Date): { hour: number; minute: number } {
  const m = date.getMinutes();
  const rounded = Math.ceil(m / 5) * 5;
  if (rounded >= 60) return { hour: (date.getHours() + 1) % 24, minute: 0 };
  return { hour: date.getHours(), minute: rounded };
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '日付を選択';
  const d = new Date(`${dateStr}T00:00:00`);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${DOW_JA[d.getDay()]})`;
}

function readCurrentRole(): FamilyRole | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return (JSON.parse(raw) as StoredUser).role;
  } catch {
    return null;
  }
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

  const [currentRole] = useState<FamilyRole | null>(readCurrentRole);
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState(dateStr);
  const [endDate, setEndDate] = useState(dateStr);
  const [allDay, setAllDay] = useState(false);
  const [startHour, setStartHour] = useState(initHour);
  const [startMinute, setStartMinute] = useState(initMin);
  const [endHour, setEndHour] = useState(initEndHour);
  const [endMinute, setEndMinute] = useState(initMin);
  const [location, setLocation] = useState('');
  const [memo, setMemo] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [suggestions, setSuggestions] = useState<EventTemplate[]>([]);

  // タイトル入力中にサジェストを取得（300ms デバウンス）
  useEffect(() => {
    const query = title.trim();
    if (!query) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ title: query });
        if (currentRole) params.set('person', currentRole);
        const res = await apiFetch(`/api/event-suggestions?${params.toString()}`);
        if (res.ok) setSuggestions((await res.json()) as EventTemplate[]);
      } catch {
        setSuggestions([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [title, currentRole]);

  const applyTemplate = (template: EventTemplate) => {
    if (template.start_time) {
      const [h, m] = template.start_time.split(':').map(Number);
      setStartHour(h);
      setStartMinute(m);
    }
    if (template.end_time) {
      const [h, m] = template.end_time.split(':').map(Number);
      setEndHour(h);
      setEndMinute(m);
    }
    setLocation(template.location);
    setMemo(template.memo);
    setSuggestions([]);
  };

  const validate = (): string[] => {
    const errs: string[] = [];
    if (!title.trim()) errs.push('タイトルを入力してください');
    if (!startDate) errs.push('開始日を入力してください');
    if (!endDate) errs.push('終了日を入力してください');
    if (startDate && endDate && endDate < startDate)
      errs.push('終了日は開始日以降を指定してください');
    // 終日OFFの場合は開始時間必須
    if (!allDay && (startHour == null || startMinute == null))
      errs.push('開始時間を入力してください');
    if (!allDay && startDate === endDate) {
      if (endHour * 60 + endMinute <= startHour * 60 + startMinute)
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
        end_time: allDay ? '' : `${pad2(endHour)}:${pad2(endMinute)}`,
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

  const showSuggestions = suggestions.length > 0 && title.trim().length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 shrink-0">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="h-11 flex items-center text-sm text-zinc-500 hover:text-zinc-700 px-1"
        >
          キャンセル
        </button>
        <h2 className="text-base font-semibold text-zinc-900">予定を登録</h2>
        <button
          type="button"
          onClick={handleSave}
          disabled={submitting}
          className="h-11 flex items-center text-sm font-semibold text-zinc-900 hover:text-zinc-600 disabled:opacity-50 px-1"
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

        {/* Title with suggestions */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-500">
            タイトル <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="予定のタイトル"
              className="w-full h-11 border border-zinc-200 rounded-xl px-3 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-300"
            />
            {showSuggestions && (
              <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-xl shadow-lg overflow-hidden">
                {suggestions.map((s) => {
                  const color = FAMILY_COLORS[s.person];
                  const timeLabel = s.start_time
                    ? s.end_time
                      ? `${s.start_time}〜${s.end_time}`
                      : s.start_time
                    : '';
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => applyTemplate(s)}
                      className="w-full text-left px-3 py-2.5 hover:bg-zinc-50 border-b border-zinc-100 last:border-0"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          style={{ color: color.main }}
                          className="text-[10px] font-semibold shrink-0"
                        >
                          {color.label}
                        </span>
                        <span className="text-sm text-zinc-900 truncate flex-1">{s.title}</span>
                        {timeLabel && (
                          <span className="text-[10px] text-zinc-400 shrink-0">{timeLabel}</span>
                        )}
                      </div>
                      {s.location && (
                        <p className="text-[10px] text-zinc-400 mt-0.5 pl-5 truncate">
                          📍 {s.location}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
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

        {/* Start row: date + time (if !allDay) */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-zinc-500">開始</span>
          <div className="flex items-center gap-2">
            <DateButton value={startDate} onChange={handleStartDateChange} label="開始日" />
            {!allDay && (
              <TimeSelect
                hour={startHour}
                minute={startMinute}
                onHourChange={setStartHour}
                onMinuteChange={setStartMinute}
              />
            )}
          </div>
        </div>

        {/* End row: date + time (if !allDay) */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-zinc-500">終了</span>
          <div className="flex items-center gap-2">
            <DateButton value={endDate} min={startDate} onChange={setEndDate} label="終了日" />
            {!allDay && (
              <TimeSelect
                hour={endHour}
                minute={endMinute}
                onHourChange={setEndHour}
                onMinuteChange={setEndMinute}
              />
            )}
          </div>
        </div>

        {/* Location */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-500">場所</label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="場所を入力"
            className="h-11 border border-zinc-200 rounded-xl px-3 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-300"
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

// ---- DateButton ----
// 日付をボタン風に表示し、タップで native date picker を開く。
// 透明な <input type="date"> を重ねることで見た目は自由にしつつ
// iOS / Android の native UI を活用する。

interface DateButtonProps {
  value: string;
  onChange: (val: string) => void;
  min?: string;
  label: string;
}

function DateButton({ value, onChange, min, label }: DateButtonProps) {
  return (
    // flex-1 min-w-0 で日付欄が時間欄を押し潰さないようにする
    <div className="relative flex-1 min-w-0">
      {/* 表示層（pointer-events-none でタップを透過させる） */}
      <div
        className="flex items-center h-11 px-3 bg-zinc-100 rounded-xl pointer-events-none select-none"
        aria-hidden="true"
      >
        <span className="text-sm text-zinc-900 truncate leading-none">{formatDate(value)}</span>
      </div>
      {/* 透明な入力層（タップを受けて native date picker を開く） */}
      <input
        type="date"
        value={value}
        min={min}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
    </div>
  );
}

// ---- TimeSelect ----
// 時・分を select で選択する。appearance-none でブラウザ標準矢印を非表示にし、
// ボタン風の見た目にする。shrink-0 で幅が潰れないようにする。

interface TimeSelectProps {
  hour: number;
  minute: number;
  onHourChange: (h: number) => void;
  onMinuteChange: (m: number) => void;
}

function TimeSelect({ hour, minute, onHourChange, onMinuteChange }: TimeSelectProps) {
  return (
    // shrink-0 で日付欄が伸びても時間欄の幅が縮まないようにする
    <div className="shrink-0 flex items-center h-11 bg-zinc-100 rounded-xl px-2.5 gap-0.5">
      <select
        value={hour}
        onChange={(e) => onHourChange(Number(e.target.value))}
        className="h-full w-7 bg-transparent text-sm text-zinc-900 appearance-none text-center focus:outline-none"
      >
        {HOUR_LIST.map((h) => (
          <option key={h} value={h}>
            {pad2(h)}
          </option>
        ))}
      </select>
      <span className="text-sm text-zinc-900 select-none leading-none">:</span>
      <select
        value={minute}
        onChange={(e) => onMinuteChange(Number(e.target.value))}
        className="h-full w-7 bg-transparent text-sm text-zinc-900 appearance-none text-center focus:outline-none"
      >
        {MINUTE_LIST.map((m) => (
          <option key={m} value={m}>
            {pad2(m)}
          </option>
        ))}
      </select>
    </div>
  );
}
