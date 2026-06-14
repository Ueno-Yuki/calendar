'use client';

import { useState, useEffect } from 'react';
import { CalendarDays, Clock, MapPin, FileText, ToggleLeft, ToggleRight } from 'lucide-react';
import type { EventTemplate, FamilyRole } from '@/types';
import { apiFetch } from '@/lib/apiClient';
import { STORAGE_KEY } from '@/lib/auth';
import type { StoredUser } from '@/lib/auth';
import { FAMILY_COLORS } from '@/lib/colors';
import { isKappaTitle, formatEndTime, KAPPA_LAST_END_TIME } from '@/lib/kappaShift';

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

// 短縮表示: 6/15(月)
function formatDateShort(dateStr: string): string {
  if (!dateStr) return '日付';
  const d = new Date(`${dateStr}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}(${DOW_JA[d.getDay()]})`;
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
  const [isLast, setIsLast] = useState(false);

  // 母 + かっぱタイトルの場合のみ「ラスト」選択肢を表示
  const showLastOption = currentRole === 'mother' && isKappaTitle(title);

  // タイトルが「かっぱ」「カッパ」から外れたらラスト選択を解除
  useEffect(() => {
    if (!showLastOption) setIsLast(false);
  }, [showLastOption]);

  useEffect(() => {
    const query = title.trim();
    if (!query) { setSuggestions([]); return; }
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
      setStartHour(h); setStartMinute(m);
    }
    if (template.end_time) {
      const [h, m] = template.end_time.split(':').map(Number);
      setEndHour(h); setEndMinute(m);
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
    if (!allDay && (startHour == null || startMinute == null))
      errs.push('開始時間を入力してください');
    if (!allDay && startDate === endDate) {
      // ラスト選択時は end = 23:59 として判定
      const effEndH = isLast ? 23 : endHour;
      const effEndM = isLast ? 59 : endMinute;
      if (effEndH * 60 + effEndM <= startHour * 60 + startMinute)
        errs.push('終了時間は開始時間より後を指定してください');
    }
    return errs;
  };

  const handleSave = async () => {
    const errs = validate();
    if (errs.length > 0) { setErrors(errs); return; }
    setErrors([]);
    setSubmitting(true);
    try {
      const body = {
        title: title.trim(),
        start_date: startDate,
        end_date: endDate,
        all_day: allDay,
        start_time: allDay ? '' : `${pad2(startHour)}:${pad2(startMinute)}`,
        end_time: allDay ? '' : isLast ? KAPPA_LAST_END_TIME : `${pad2(endHour)}:${pad2(endMinute)}`,
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

      {/* ヘッダー */}
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

      {/* スクロール可能なフォーム本体 */}
      <div className="overflow-y-auto flex-1 pb-8">

        {/* エラーバナー */}
        {errors.length > 0 && (
          <div className="mx-4 mt-3 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
            {errors.map((e, i) => (
              <p key={i} className="text-sm text-red-600 leading-5">{e}</p>
            ))}
          </div>
        )}

        {/* タイトル — 大きめ入力 */}
        <div className="relative px-4 pt-5 pb-4 border-b border-zinc-100">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="予定のタイトル"
            style={{ fontSize: 22 }}
            className="w-full font-semibold text-zinc-900 placeholder-zinc-400 bg-transparent focus:outline-none"
          />
          {showSuggestions && (
            <div className="absolute z-10 left-4 right-4 top-full mt-1 bg-white border border-zinc-200 rounded-xl shadow-lg overflow-hidden">
              {suggestions.map((s) => {
                const color = FAMILY_COLORS[s.person];
                const displayEnd = s.end_time
                  ? formatEndTime({ person: s.person, title: s.title, end_time: s.end_time })
                  : '';
                const timeLabel = s.start_time
                  ? displayEnd ? `${s.start_time}〜${displayEnd}` : s.start_time
                  : '';
                return (
                  <button
                    key={s.id}
                    type="button"
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => applyTemplate(s)}
                    className="w-full text-left px-3 py-2.5 hover:bg-zinc-50 border-b border-zinc-100 last:border-0 active:bg-zinc-100"
                  >
                    <div className="flex items-center gap-2">
                      <span style={{ color: color.main }} className="text-[10px] font-semibold shrink-0">{color.label}</span>
                      <span className="text-sm text-zinc-900 truncate flex-1">{s.title}</span>
                      {timeLabel && <span className="text-[10px] text-zinc-400 shrink-0">{timeLabel}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* リスト行 */}

        {/* カレンダー（表示のみ） */}
        <ListRow icon={<CalendarDays size={18} className="text-green-500" />}>
          <span className="text-sm text-zinc-400">家族カレンダー</span>
        </ListRow>

        {/* 終日トグル */}
        <ListRow icon={allDay
          ? <ToggleRight size={18} className="text-orange-500" />
          : <ToggleLeft size={18} className="text-orange-400" />
        }>
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
        </ListRow>

        {/* 開始 */}
        <ListRow icon={<Clock size={18} className="text-blue-500" />}>
          <div className="flex items-center">
            <span className="text-sm text-zinc-500 shrink-0">開始</span>
            <div className="ml-auto flex items-center gap-2">
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
        </ListRow>

        {/* 終了（アイコンなし — 開始行の続き） */}
        <ListRow>
          <div className="flex items-center">
            <span className="text-sm text-zinc-500 shrink-0">終了</span>
            <div className="ml-auto flex items-center gap-2">
              <DateButton value={endDate} min={startDate} onChange={setEndDate} label="終了日" />
              {!allDay && (
                isLast ? (
                  /* ラスト選択中 — ダークボタンをタップで解除 */
                  <button
                    type="button"
                    onClick={() => setIsLast(false)}
                    className="shrink-0 h-9 px-3 rounded-lg bg-zinc-800 text-sm text-white font-medium"
                  >
                    ラスト
                  </button>
                ) : (
                  <>
                    <TimeSelect
                      hour={endHour}
                      minute={endMinute}
                      onHourChange={setEndHour}
                      onMinuteChange={setEndMinute}
                    />
                    {/* 母 + かっぱタイトルのときのみ「ラスト」ボタンを表示 */}
                    {showLastOption && (
                      <button
                        type="button"
                        onClick={() => setIsLast(true)}
                        className="shrink-0 h-9 px-2.5 rounded-lg bg-zinc-100 text-sm text-zinc-500 active:bg-zinc-200"
                      >
                        ラスト
                      </button>
                    )}
                  </>
                )
              )}
            </div>
          </div>
        </ListRow>

        {/* 場所 */}
        <ListRow icon={<MapPin size={18} className="text-red-500" />}>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="場所を入力"
            style={{ fontSize: 16 }}
            className="w-full text-zinc-900 placeholder-zinc-400 bg-transparent focus:outline-none"
          />
        </ListRow>

        {/* メモ */}
        <ListRow icon={<FileText size={18} className="text-purple-500" />} alignTop>
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="メモを入力"
            rows={3}
            style={{ fontSize: 16 }}
            className="w-full text-zinc-900 placeholder-zinc-400 bg-transparent focus:outline-none resize-none leading-relaxed"
          />
        </ListRow>

      </div>
    </div>
  );
}

// ---- ListRow ----
// TimeTree風リスト行: 左アイコン + 右コンテンツ
// icon を省略すると空白（幅20px）を確保して上下の行と揃える

interface ListRowProps {
  icon?: React.ReactNode;
  alignTop?: boolean;
  children: React.ReactNode;
}

function ListRow({ icon, alignTop = false, children }: ListRowProps) {
  return (
    <div
      className={`flex gap-3 px-4 border-b border-zinc-100 min-h-[52px] ${
        alignTop ? 'items-start py-4' : 'items-center py-3'
      }`}
    >
      {/* アイコン列 — 常に20px確保して行同士を揃える */}
      <div className="shrink-0 w-5 flex justify-center text-zinc-400">
        {icon}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

// ---- DateButton ----
// 短縮日付（6/15(月)）を表示するボタン。
// 透明な input[type=date] を重ねてネイティブ日付ピッカーを開く。
// 非表示inputはfont-sizeをglobals.cssのbase ruleで16pxに確保し、iOSズームを防ぐ。

interface DateButtonProps {
  value: string;
  onChange: (val: string) => void;
  min?: string;
  label: string;
}

function DateButton({ value, onChange, min, label }: DateButtonProps) {
  return (
    <div className="relative shrink-0">
      {/* 表示層 */}
      <div
        className="flex items-center justify-center h-9 px-2.5 bg-zinc-100 rounded-lg pointer-events-none select-none"
        aria-hidden="true"
      >
        <span className="text-sm text-zinc-900 whitespace-nowrap leading-none">
          {formatDateShort(value)}
        </span>
      </div>
      {/* タップ層（透明） — font-sizeはbase ruleで16pxになりiOSズームしない */}
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
// 「20:45」のように見える時刻入力。
// 時・分を別々の select で入力するが、ひとつのボタン風UIとして見せる。
// iOS zoom防止のためfont-sizeをinline styleで16pxに固定する。

interface TimeSelectProps {
  hour: number;
  minute: number;
  onHourChange: (h: number) => void;
  onMinuteChange: (m: number) => void;
}

function TimeSelect({ hour, minute, onHourChange, onMinuteChange }: TimeSelectProps) {
  return (
    <div className="shrink-0 flex items-center h-9 bg-zinc-100 rounded-lg px-3 gap-0">
      <select
        value={hour}
        onChange={(e) => onHourChange(Number(e.target.value))}
        style={{ fontSize: 16 }}
        className="h-full w-6 bg-transparent text-zinc-900 appearance-none text-center focus:outline-none"
      >
        {HOUR_LIST.map((h) => (
          <option key={h} value={h}>{pad2(h)}</option>
        ))}
      </select>
      <span className="text-sm text-zinc-900 select-none leading-none">:</span>
      <select
        value={minute}
        onChange={(e) => onMinuteChange(Number(e.target.value))}
        style={{ fontSize: 16 }}
        className="h-full w-6 bg-transparent text-zinc-900 appearance-none text-center focus:outline-none"
      >
        {MINUTE_LIST.map((m) => (
          <option key={m} value={m}>{pad2(m)}</option>
        ))}
      </select>
    </div>
  );
}
