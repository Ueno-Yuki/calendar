'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { X, Plus, Trash2, Pencil, MapPin } from 'lucide-react';
import { formatEventTimeRange } from '@/lib/kappaShift';
import type { Event, FamilyRole } from '@/types';
import { FAMILY_COLORS } from '@/lib/colors';
import { STORAGE_KEY } from '@/lib/auth';
import type { StoredUser } from '@/lib/auth';
import { apiFetch } from '@/lib/apiClient';
import EventCreateForm from './EventCreateForm';
import DeleteConfirmModal from './DeleteConfirmModal';

const DOW_FULL = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
const ACTION_BTN_WIDTH = 72; // px — 削除・編集ボタンの幅
const CLOSE_SWIPE_THRESHOLD = 80;

interface Props {
  dateStr: string;
  events: Event[];
  onClose: () => void;
  onEventCreated: () => void;
  onEventDeleted: () => void;
  onRefreshBlockChange: (blocked: boolean) => void;
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

export default function DayModal({
  dateStr,
  events,
  onClose,
  onEventCreated,
  onEventDeleted,
  onRefreshBlockChange,
}: Props) {
  const [mode, setMode] = useState<'schedule' | 'create' | 'edit'>('schedule');
  const [swipedEventId, setSwipedEventId] = useState<string | null>(null);
  const [swipedDirection, setSwipedDirection] = useState<'left' | 'right'>('left');
  const [eventToDelete, setEventToDelete] = useState<Event | null>(null);
  const [eventToEdit, setEventToEdit] = useState<Event | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const currentRole = readCurrentRole();
  const headerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const closeTouchStartXRef = useRef<number | null>(null);
  const closeTouchStartYRef = useRef<number | null>(null);
  const closeGestureEnabledRef = useRef(false);
  const dragOffsetYRef = useRef(0);

  const isRefreshBlocked = mode === 'create' || mode === 'edit' || eventToDelete !== null;

  useEffect(() => {
    onRefreshBlockChange(isRefreshBlocked);
    return () => onRefreshBlockChange(false);
  }, [isRefreshBlocked, onRefreshBlockChange]);

  const date = new Date(`${dateStr}T00:00:00`);
  const dow = date.getDay();
  const dowColorClass = dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-zinc-900';
  const heading = `${date.getMonth() + 1}月${date.getDate()}日 ${DOW_FULL[dow]}`;

  const dayEvents = useMemo(
    () => events.filter((e) => !e.deleted && e.start_date <= dateStr && e.end_date >= dateStr),
    [events, dateStr],
  );

  const allDaySection = useMemo(
    () =>
      dayEvents
        .filter((e) => e.start_date === e.end_date && (e.all_day || !e.start_time))
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [dayEvents],
  );

  const multiDaySection = useMemo(
    () =>
      dayEvents
        .filter((e) => e.start_date !== e.end_date)
        .sort((a, b) => {
          const startDateCompare = a.start_date.localeCompare(b.start_date);
          if (startDateCompare !== 0) return startDateCompare;
          return a.created_at.localeCompare(b.created_at);
        }),
    [dayEvents],
  );

  const timedSection = useMemo(
    () =>
      dayEvents
        .filter((e) => e.start_date === e.end_date && !e.all_day && !!e.start_time)
        .sort((a, b) => {
          const startTimeCompare = a.start_time.localeCompare(b.start_time);
          if (startTimeCompare !== 0) return startTimeCompare;
          return a.created_at.localeCompare(b.created_at);
        }),
    [dayEvents],
  );

  // 新規作成保存後
  const handleSaved = () => {
    onEventCreated();
    setMode('schedule');
  };

  // 編集保存後
  const handleEditSaved = () => {
    onEventCreated(); // refreshKey++ で再取得
    setMode('schedule');
    setEventToEdit(null);
  };

  const handleEditCancel = () => {
    setMode('schedule');
    setEventToEdit(null);
  };

  const handleDeleteRequest = (event: Event) => {
    setEventToDelete(event);
  };

  const handleEditRequest = (event: Event) => {
    setSwipedEventId(null);
    setEventToEdit(event);
    setMode('edit');
  };

  const handleDeleteCancel = () => {
    setEventToDelete(null);
    setSwipedEventId(null);
  };

  const handleDeleteConfirm = async () => {
    if (!eventToDelete) return;
    setIsDeleting(true);
    try {
      const [y, m] = eventToDelete.start_date.split('-');
      const res = await apiFetch(
        `/api/events/${eventToDelete.id}?year=${y}&month=${m}`,
        { method: 'DELETE' },
      );
      if (!res.ok) return;
      setEventToDelete(null);
      setSwipedEventId(null);
      onEventDeleted();
    } catch {
      setEventToDelete(null);
      setSwipedEventId(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const canAction = (event: Event) => currentRole !== null && event.owner === currentRole;

  const handleSwipeLeft = (id: string) => {
    setSwipedEventId(id);
    setSwipedDirection('left');
  };

  const handleSwipeRight = (id: string) => {
    setSwipedEventId(id);
    setSwipedDirection('right');
  };

  const backdropClickable = mode === 'schedule' && eventToDelete === null;

  const resetCloseGesture = () => {
    closeTouchStartXRef.current = null;
    closeTouchStartYRef.current = null;
    closeGestureEnabledRef.current = false;
    dragOffsetYRef.current = 0;
    setDragOffsetY(0);
  };

  const handleSheetTouchStart = (e: React.TouchEvent) => {
    if (mode !== 'schedule' || eventToDelete !== null) return;
    const target = e.target as Node;
    const startedInHeader = headerRef.current?.contains(target) ?? false;
    const canStartFromList = (listRef.current?.scrollTop ?? 0) <= 0;

    closeGestureEnabledRef.current = startedInHeader || canStartFromList;
    if (!closeGestureEnabledRef.current) return;

    closeTouchStartXRef.current = e.touches[0].clientX;
    closeTouchStartYRef.current = e.touches[0].clientY;
  };

  const handleSheetTouchMove = (e: React.TouchEvent) => {
    if (!closeGestureEnabledRef.current) return;
    if (closeTouchStartXRef.current === null || closeTouchStartYRef.current === null) return;

    const dx = e.touches[0].clientX - closeTouchStartXRef.current;
    const dy = e.touches[0].clientY - closeTouchStartYRef.current;

    if (dy <= 0 || Math.abs(dy) <= Math.abs(dx)) {
      dragOffsetYRef.current = 0;
      setDragOffsetY(0);
      return;
    }

    dragOffsetYRef.current = Math.min(dy, 160);
    setDragOffsetY(dragOffsetYRef.current);
  };

  const handleSheetTouchEnd = () => {
    if (!closeGestureEnabledRef.current) {
      dragOffsetYRef.current = 0;
      setDragOffsetY(0);
      return;
    }

    if (dragOffsetYRef.current > CLOSE_SWIPE_THRESHOLD) {
      resetCloseGesture();
      onClose();
      return;
    }

    resetCloseGesture();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={backdropClickable ? onClose : undefined}
        aria-hidden="true"
      />

      <div
        className="fixed inset-x-0 bottom-0 z-50 flex flex-col overflow-hidden rounded-t-[24px] bg-white shadow-[0_-12px_32px_rgba(15,23,42,0.16)]"
        style={{
          top: 'max(80px, env(safe-area-inset-top))',
          transform: `translateY(${dragOffsetY}px)`,
          transition: dragOffsetY > 0 ? 'none' : 'transform 0.22s ease-out',
        }}
        onTouchStart={handleSheetTouchStart}
        onTouchMove={handleSheetTouchMove}
        onTouchEnd={handleSheetTouchEnd}
        onTouchCancel={resetCloseGesture}
      >
        {mode === 'create' ? (
          <EventCreateForm
            dateStr={dateStr}
            onSaved={handleSaved}
            onCancel={() => setMode('schedule')}
          />
        ) : mode === 'edit' && eventToEdit ? (
          <EventCreateForm
            dateStr={eventToEdit.start_date}
            mode="edit"
            initialEvent={eventToEdit}
            onSaved={handleEditSaved}
            onCancel={handleEditCancel}
          />
        ) : (
          <>
            <div ref={headerRef} className="shrink-0 border-b border-zinc-100 px-5 pb-3 pt-2">
              <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-zinc-200" aria-hidden="true" />
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-zinc-400">予定一覧</p>
                  <h2 className={`mt-1 text-[28px] font-semibold leading-tight ${dowColorClass}`}>
                    {heading}
                  </h2>
                </div>
                <div className="flex items-center gap-1 pt-0.5">
                  <button
                    type="button"
                    onClick={() => { setSwipedEventId(null); setMode('create'); }}
                    aria-label="予定を追加"
                    className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900"
                  >
                    <Plus size={20} strokeWidth={2.5} />
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="閉じる"
                    className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
                  >
                    <X size={20} strokeWidth={2.5} />
                  </button>
                </div>
              </div>
            </div>

            {/* Event list */}
            <div ref={listRef} className="flex-1 overflow-y-auto pb-10">
              {dayEvents.length === 0 ? (
                <div className="flex min-h-full items-center justify-center px-6 py-12 text-center">
                  <p className="text-sm text-zinc-400">予定がありません</p>
                </div>
              ) : (
                <div className="px-4 pb-6 pt-4">
                  <div className="flex flex-col gap-4">
                    {allDaySection.length > 0 && (
                      <div>
                        <p className="mb-2 text-[11px] font-medium tracking-[0.02em] text-zinc-400">終日</p>
                        <div className="flex flex-col gap-2">
                          {allDaySection.map((e) => (
                            <SwipeableEventCard
                              key={e.id}
                              event={e}
                              showTime={false}
                              isSwiped={swipedEventId === e.id}
                              swipeDir={swipedEventId === e.id ? swipedDirection : 'left'}
                              canAction={canAction(e)}
                              onSwipeLeft={() => handleSwipeLeft(e.id)}
                              onSwipeRight={() => handleSwipeRight(e.id)}
                              onCloseSwipe={() => setSwipedEventId(null)}
                              onDeleteRequest={handleDeleteRequest}
                              onEditRequest={handleEditRequest}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {multiDaySection.length > 0 && (
                      <div>
                        <p className="mb-2 text-[11px] font-medium tracking-[0.02em] text-zinc-400">複数日</p>
                        <div className="flex flex-col gap-2">
                          {multiDaySection.map((e) => (
                            <SwipeableEventCard
                              key={e.id}
                              event={e}
                              showTime={false}
                              isSwiped={swipedEventId === e.id}
                              swipeDir={swipedEventId === e.id ? swipedDirection : 'left'}
                              canAction={canAction(e)}
                              onSwipeLeft={() => handleSwipeLeft(e.id)}
                              onSwipeRight={() => handleSwipeRight(e.id)}
                              onCloseSwipe={() => setSwipedEventId(null)}
                              onDeleteRequest={handleDeleteRequest}
                              onEditRequest={handleEditRequest}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {timedSection.length > 0 && (
                      <div>
                        <p className="mb-2 text-[11px] font-medium tracking-[0.02em] text-zinc-400">時間指定</p>
                        <div className="flex flex-col gap-2">
                          {timedSection.map((e) => (
                            <SwipeableEventCard
                              key={e.id}
                              event={e}
                              showTime
                              isSwiped={swipedEventId === e.id}
                              swipeDir={swipedEventId === e.id ? swipedDirection : 'left'}
                              canAction={canAction(e)}
                              onSwipeLeft={() => handleSwipeLeft(e.id)}
                              onSwipeRight={() => handleSwipeRight(e.id)}
                              onCloseSwipe={() => setSwipedEventId(null)}
                              onDeleteRequest={handleDeleteRequest}
                              onEditRequest={handleEditRequest}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Delete confirmation (z-[60]/z-[70] — above DayModal sheet) */}
      {eventToDelete && (
        <DeleteConfirmModal
          event={eventToDelete}
          onCancel={handleDeleteCancel}
          onConfirm={handleDeleteConfirm}
          isDeleting={isDeleting}
        />
      )}
    </>
  );
}

// ---- SwipeableEventCard ----
// 左スワイプ → 赤い削除ボタン表示
// 右スワイプ → 青い編集ボタン表示（タップで編集フォームを開く）

interface SwipeableProps {
  event: Event;
  showTime: boolean;
  isSwiped: boolean;
  swipeDir: 'left' | 'right';
  canAction: boolean;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  onCloseSwipe: () => void;
  onDeleteRequest: (event: Event) => void;
  onEditRequest: (event: Event) => void;
}

function SwipeableEventCard({
  event,
  showTime,
  isSwiped,
  swipeDir,
  canAction,
  onSwipeLeft,
  onSwipeRight,
  onCloseSwipe,
  onDeleteRequest,
  onEditRequest,
}: SwipeableProps) {
  const touchStartX = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;

    // スワイプ中なら閉じる
    if (isSwiped) {
      onCloseSwipe();
      return;
    }
    if (!canAction) return;

    if (dx < -40) {
      onSwipeLeft();   // 左スワイプ → 削除ボタン
    } else if (dx > 40) {
      onSwipeRight();  // 右スワイプ → 編集ボタン
    }
  };

  const offset = isSwiped
    ? swipeDir === 'right' ? ACTION_BTN_WIDTH : -ACTION_BTN_WIDTH
    : 0;

  return (
    <div className="relative overflow-hidden rounded-xl">
      {/* 編集ボタン（左側・青） — 右スワイプで出現 */}
      {canAction && isSwiped && swipeDir === 'right' && (
        <div
          className="absolute inset-y-0 left-0 flex items-center justify-center rounded-l-xl bg-blue-500"
          style={{ width: ACTION_BTN_WIDTH }}
        >
          <button
            type="button"
            onClick={() => onEditRequest(event)}
            className="flex items-center justify-center w-full h-full"
            aria-label="編集"
          >
            <Pencil size={20} stroke="white" strokeWidth={2} />
          </button>
        </div>
      )}

      {/* 削除ボタン（右側・赤） — 左スワイプで出現 */}
      {canAction && isSwiped && swipeDir === 'left' && (
        <div
          className="absolute inset-y-0 right-0 flex items-center justify-center rounded-r-xl bg-red-500"
          style={{ width: ACTION_BTN_WIDTH }}
        >
          <button
            type="button"
            onClick={() => onDeleteRequest(event)}
            className="flex items-center justify-center w-full h-full"
            aria-label="削除"
          >
            <Trash2 size={20} stroke="white" strokeWidth={2} />
          </button>
        </div>
      )}

      {/* イベントカード（スライドして左右のボタンを露出） */}
      <div
        style={{
          transform: `translateX(${offset}px)`,
          transition: 'transform 0.2s ease-out',
        }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <EventCard
          event={event}
          showTime={showTime}
          canAction={canAction}
          isSwiped={isSwiped}
          swipeDir={swipeDir}
          onEditRequest={onEditRequest}
          onDeleteRequest={onDeleteRequest}
        />
      </div>
    </div>
  );
}

// ---- EventCard ----

interface EventCardProps {
  event: Event;
  showTime: boolean;
  canAction: boolean;
  isSwiped: boolean;
  swipeDir: 'left' | 'right';
  onEditRequest: (event: Event) => void;
  onDeleteRequest: (event: Event) => void;
}

function EventCard({
  event,
  showTime,
  canAction,
  isSwiped,
  swipeDir,
  onEditRequest,
  onDeleteRequest,
}: EventCardProps) {
  const color = FAMILY_COLORS[event.person];
  const timeLabel = showTime ? formatEventTimeRange(event) : '';
  const cardRadiusClass = isSwiped
    ? swipeDir === 'left'
      ? 'rounded-l-xl rounded-r-none'
      : 'rounded-l-none rounded-r-xl'
    : 'rounded-xl';

  return (
    <div
      style={{ borderLeftColor: color.main, backgroundColor: color.light }}
      className={`border-l-[3px] px-3 py-2.5 ${cardRadiusClass}`}
    >
      {timeLabel && (
        <p className="text-xs font-medium text-zinc-500 mb-1.5 tabular-nums">{timeLabel}</p>
      )}
      <div className="flex items-center gap-1">
        <div className="flex items-baseline gap-1.5 flex-1 min-w-0">
          <span style={{ color: color.main }} className="text-xs font-bold shrink-0">
            {color.label}
          </span>
          <span className="text-sm font-semibold text-zinc-900 leading-snug">{event.title}</span>
        </div>
        {canAction && (
          <div
            className="flex items-center shrink-0 -mr-1.5"
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => onEditRequest(event)}
              aria-label="編集"
              className="flex items-center justify-center w-9 h-9 text-blue-500 active:text-blue-700"
            >
              <Pencil size={14} strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={() => onDeleteRequest(event)}
              aria-label="削除"
              className="flex items-center justify-center w-9 h-9 text-red-400 active:text-red-600"
            >
              <Trash2 size={14} strokeWidth={2} />
            </button>
          </div>
        )}
      </div>
      {event.location && (
        <p className="flex items-center gap-0.5 text-xs text-zinc-500 mt-1 truncate">
          <MapPin size={11} className="shrink-0" />
          {event.location}
        </p>
      )}
      {event.memo && (
        <p className="text-xs text-zinc-400 mt-0.5 line-clamp-2 whitespace-pre-line">
          {event.memo}
        </p>
      )}
    </div>
  );
}
