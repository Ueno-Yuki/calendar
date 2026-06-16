'use client';

import { useState, useEffect } from 'react';
import { CalendarDays, Clock, MapPin, FileText, ToggleLeft, ToggleRight, BellOff, X } from 'lucide-react';
import type { EventTemplate, FamilyRole } from '@/types';
import { apiFetch } from '@/lib/apiClient';
import { STORAGE_KEY } from '@/lib/auth';
import type { StoredUser } from '@/lib/auth';
import type { Event } from '@/types';
import { isKappaTitle, formatEndTime, KAPPA_LAST_END_TIME } from '@/lib/kappaShift';
import TimePickerSheet from '@/components/modal/TimePickerSheet';
import {
  DEFAULT_QUIET_HOURS,
  isInQuietHours,
  normalizeQuietHoursSettings,
  type QuietHoursSettings,
} from '@/lib/quietHours';

const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function roundTo5Min(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes();
  const rounded = Math.ceil(m / 5) * 5;
  if (rounded >= 60) return `${pad2((h + 1) % 24)}:00`;
  return `${pad2(h)}:${pad2(rounded)}`;
}

function addOneHour(time: string): string {
  const [h, m] = time.split(':').map(Number);
  return `${pad2((h + 1) % 24)}:${pad2(m)}`;
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

function canUseKappaLast(role: FamilyRole | null): boolean {
  return role === 'mother' || role === 'me';
}

interface Props {
  dateStr: string;
  mode?: 'create' | 'edit';
  initialEvent?: Event;
  onSaved: () => void;
  onCancel: () => void;
}

export default function EventCreateForm({
  dateStr,
  mode = 'create',
  initialEvent,
  onSaved,
  onCancel,
}: Props) {
  const now = new Date();
  // 編集モードでは既存予定の値を初期値として使用する
  const initStartTime = initialEvent?.start_time || roundTo5Min(now);
  const initIsLast = !!initialEvent?.end_time && initialEvent.end_time === KAPPA_LAST_END_TIME;
  const initEndTime = (!initialEvent?.end_time || initIsLast)
    ? addOneHour(initStartTime)
    : initialEvent.end_time;

  const [currentRole, setCurrentRole] = useState<FamilyRole | null>(readCurrentRole);
  const [quietHours, setQuietHours] = useState<QuietHoursSettings>(DEFAULT_QUIET_HOURS);
  const [title, setTitle] = useState(initialEvent?.title ?? '');
  const [startDate, setStartDate] = useState(initialEvent?.start_date ?? dateStr);
  const [endDate, setEndDate] = useState(initialEvent?.end_date ?? dateStr);
  const [allDay, setAllDay] = useState(initialEvent?.all_day ?? false);
  const [startTime, setStartTime] = useState(initStartTime);
  const [endTime, setEndTime] = useState(initEndTime);
  const [isLast, setIsLast] = useState(initIsLast);
  const [location, setLocation] = useState(initialEvent?.location ?? '');
  const [memo, setMemo] = useState(initialEvent?.memo ?? '');
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [suggestions, setSuggestions] = useState<EventTemplate[]>([]);
  const [suppressSuggestions, setSuppressSuggestions] = useState(false);

  // どの時刻ピッカーを開いているか
  const [timePickerFor, setTimePickerFor] = useState<'start' | 'end' | null>(null);

  // 母または自分 + かっぱタイトルの場合のみ「ラスト」選択肢を表示
  const showLastOption = canUseKappaLast(currentRole) && isKappaTitle(title);

  // タイトルが「かっぱ」「カッパ」から外れたらラスト選択を解除
  useEffect(() => {
    if (!showLastOption) setIsLast(false);
  }, [showLastOption]);

  useEffect(() => {
    setCurrentRole(readCurrentRole());
  }, []);

  useEffect(() => {
    if (suppressSuggestions) return;
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
  }, [title, currentRole, suppressSuggestions]);

  useEffect(() => {
    if (!currentRole) return;
    apiFetch('/api/settings/notifications')
      .then((res) => (res.ok ? (res.json() as Promise<Partial<QuietHoursSettings>>) : null))
      .then((data) => {
        if (data) setQuietHours(normalizeQuietHoursSettings(data));
      })
      .catch(() => {});
  }, [currentRole]);

  const handleDeleteTemplate = (id: string) => {
    // 楽観的UI更新: 即座にリストから除去してからAPIを呼ぶ
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
    apiFetch(`/api/event-suggestions/${id}`, { method: 'DELETE' }).catch(() => {});
  };

  const applyTemplate = (template: EventTemplate) => {
    setSuppressSuggestions(true);
    setTitle(template.title);
    if (template.start_time) setStartTime(template.start_time);
    if (template.end_time) {
      const templateSupportsLast = canUseKappaLast(currentRole) && isKappaTitle(template.title);
      if (template.end_time === KAPPA_LAST_END_TIME && templateSupportsLast) {
        setIsLast(true);
      } else {
        setEndTime(template.end_time);
        setIsLast(false);
      }
    }
    setSuggestions([]);
  };

  const validate = (): string[] => {
    const errs: string[] = [];
    if (!title.trim()) errs.push('タイトルを入力してください');
    if (!startDate) errs.push('開始日を入力してください');
    if (!endDate) errs.push('終了日を入力してください');
    if (startDate && endDate && endDate < startDate)
      errs.push('終了日は開始日以降を指定してください');
    if (!allDay && !startTime)
      errs.push('開始時間を入力してください');
    if (!allDay && startDate === endDate) {
      const [startH, startM] = startTime.split(':').map(Number);
      const effEndH = isLast ? 23 : parseInt(endTime.split(':')[0]);
      const effEndM = isLast ? 59 : parseInt(endTime.split(':')[1]);
      if (effEndH * 60 + effEndM <= startH * 60 + startM)
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
        start_time: allDay ? '' : startTime,
        end_time: allDay ? '' : isLast ? KAPPA_LAST_END_TIME : endTime,
        location,
        memo,
      };

      let res: Response;
      if (mode === 'edit' && initialEvent) {
        // 編集: PUT /api/events/[id]
        const [y, m] = initialEvent.start_date.split('-');
        res = await apiFetch(`/api/events/${initialEvent.id}?year=${y}&month=${m}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
      } else {
        // 新規: POST /api/events
        res = await apiFetch('/api/events', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setErrors([data.error ?? (mode === 'edit' ? '更新に失敗しました' : '登録に失敗しました')]);
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

  // 開始時間変更時: 終了時間を開始+1時間に自動補完（日付またぎ対応）
  const handleStartTimeSelect = (t: string) => {
    setStartTime(t);
    const [h, m] = t.split(':').map(Number);
    const endTotalMin = h * 60 + m + 60;
    const newEndH = Math.floor(endTotalMin / 60) % 24;
    const newEndM = endTotalMin % 60;
    setEndTime(`${pad2(newEndH)}:${pad2(newEndM)}`);
    setIsLast(false);
    if (endTotalMin >= 24 * 60) {
      // 終了時刻が翌日にまたがる場合: 終了日を1日進める
      const d = new Date(`${startDate}T00:00:00`);
      d.setDate(d.getDate() + 1);
      setEndDate(d.toISOString().slice(0, 10));
    } else {
      setEndDate(startDate);
    }
  };

  const showSuggestions = suggestions.length > 0 && title.trim().length > 0;
  const showQuietHoursNotice = isInQuietHours(quietHours);

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
        <h2 className="text-base font-semibold text-zinc-900">
          {mode === 'edit' ? '予定を編集' : '予定を登録'}
        </h2>
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
            onChange={(e) => {
              setSuppressSuggestions(false);
              setTitle(e.target.value);
            }}
            placeholder="予定のタイトル"
            style={{ fontSize: 22 }}
            className="w-full font-semibold text-zinc-900 placeholder-zinc-400 bg-transparent focus:outline-none"
          />
          {showSuggestions && (
            <div className="absolute z-10 left-4 right-4 top-full mt-1 bg-white border border-zinc-200 rounded-xl shadow-lg overflow-hidden">
              {suggestions.map((s) => {
                const displayEnd = s.end_time
                  ? formatEndTime({ person: s.person, title: s.title, end_time: s.end_time })
                  : '';
                const timeLabel = s.start_time
                  ? displayEnd ? `${s.start_time}〜${displayEnd}` : s.start_time
                  : '';
                return (
                  <div
                    key={s.id}
                    className="flex items-center border-b border-zinc-100 last:border-0"
                  >
                    {/* 候補適用ボタン */}
                    <button
                      type="button"
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => applyTemplate(s)}
                      className="flex-1 text-left px-3 py-2.5 hover:bg-zinc-50 active:bg-zinc-100 min-w-0"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-zinc-900 truncate flex-1">{s.title}</span>
                        {timeLabel && <span className="text-[10px] text-zinc-400 shrink-0">{timeLabel}</span>}
                      </div>
                    </button>
                    {/* 候補削除ボタン */}
                    <button
                      type="button"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteTemplate(s.id);
                      }}
                      aria-label="候補を削除"
                      className="flex items-center justify-center h-11 w-11 shrink-0 text-red-400 active:text-red-600"
                    >
                      <X size={15} strokeWidth={2.5} />
                    </button>
                  </div>
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
                <TimeButton
                  value={startTime}
                  onClick={() => setTimePickerFor('start')}
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
              {showLastOption && !allDay && !isLast && (
                <LastToggleChip
                  onClick={() => setIsLast(true)}
                />
              )}
              <DateButton value={endDate} min={startDate} onChange={setEndDate} label="終了日" />
              {!allDay && (
                isLast ? (
                  <TimeButton
                    value="ラスト"
                    isLast
                    onClick={() => setIsLast(false)}
                  />
                ) : (
                  <TimeButton
                    value={endTime}
                    onClick={() => setTimePickerFor('end')}
                  />
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

        {/* お休みモード補足（通知停止時間帯の控えめな注釈） */}
        {showQuietHoursNotice && (
          <div className="flex items-center gap-1 mt-2 px-4 text-xs text-slate-500">
            <BellOff className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <span>
              お休みモード中（{quietHours.quiet_hours_start}〜{quietHours.quiet_hours_end}）は通知されません
            </span>
          </div>
        )}

      </div>

      {/* 開始時刻ピッカー */}
      {timePickerFor === 'start' && (
        <TimePickerSheet
          value={startTime}
          onSelect={handleStartTimeSelect}
          onClose={() => setTimePickerFor(null)}
        />
      )}

      {/* 終了時刻ピッカー */}
      {timePickerFor === 'end' && (
        <TimePickerSheet
          value={endTime}
          isCurrentLast={isLast}
          showLastOption={showLastOption}
          onSelect={(t) => { setEndTime(t); setIsLast(false); }}
          onSelectLast={() => setIsLast(true)}
          onClose={() => setTimePickerFor(null)}
        />
      )}
    </div>
  );
}

// ---- ListRow ----

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
      <div className="shrink-0 w-5 flex justify-center text-zinc-400">
        {icon}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

// ---- DateButton ----

interface DateButtonProps {
  value: string;
  onChange: (val: string) => void;
  min?: string;
  label: string;
}

function DateButton({ value, onChange, min, label }: DateButtonProps) {
  return (
    <div className="relative shrink-0">
      <div
        className="flex items-center justify-center h-9 px-2.5 bg-zinc-100 rounded-lg pointer-events-none select-none"
        aria-hidden="true"
      >
        <span className="text-sm text-zinc-900 whitespace-nowrap leading-none">
          {formatDateShort(value)}
        </span>
      </div>
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

// ---- TimeButton ----
// 選択された時刻を1つの値として表示するボタン。
// タップするとボトムシート（TimePickerSheet）が開く。

interface TimeButtonProps {
  value: string; // "HH:MM" または "ラスト"
  isLast?: boolean;
  onClick: () => void;
}

function TimeButton({ value, isLast = false, onClick }: TimeButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 h-9 px-3 rounded-lg text-sm font-medium ${
        isLast
          ? 'border border-zinc-200 bg-zinc-100 text-zinc-700'
          : 'bg-zinc-100 text-zinc-900'
      }`}
    >
      {value}
    </button>
  );
}

interface LastToggleChipProps {
  onClick: () => void;
}

function LastToggleChip({ onClick }: LastToggleChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed="false"
      className="shrink-0 inline-flex h-9 items-center gap-1.5 rounded-full bg-zinc-100 px-3 text-xs font-semibold text-zinc-600"
    >
      <span>ラスト</span>
      <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] leading-none text-zinc-500">
        OFF
      </span>
    </button>
  );
}
