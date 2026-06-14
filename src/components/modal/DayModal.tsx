'use client';

import { useState, useMemo, useRef } from 'react';
import { X, Plus, Trash2, Pencil, MapPin } from 'lucide-react';
import { formatEventTimeRange } from '@/lib/kappaShift';
import type { Event, FamilyRole } from '@/types';
import { FAMILY_COLORS } from '@/lib/colors';
import { STORAGE_KEY } from '@/lib/auth';
import type { StoredUser } from '@/lib/auth';
import { apiFetch } from '@/lib/apiClient';
import EventCreateForm from './EventCreateForm';
import DeleteConfirmModal from './DeleteConfirmModal';

const DOW = ['日', '月', '火', '水', '木', '金', '土'];
const ACTION_BTN_WIDTH = 72; // px — 削除・編集ボタンの幅

interface Props {
  dateStr: string;
  events: Event[];
  onClose: () => void;
  onEventCreated: () => void;
  onEventDeleted: () => void;
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
}: Props) {
  const [mode, setMode] = useState<'schedule' | 'create' | 'edit'>('schedule');
  const [swipedEventId, setSwipedEventId] = useState<string | null>(null);
  const [swipedDirection, setSwipedDirection] = useState<'left' | 'right'>('left');
  const [eventToDelete, setEventToDelete] = useState<Event | null>(null);
  const [eventToEdit, setEventToEdit] = useState<Event | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [currentRole] = useState<FamilyRole | null>(readCurrentRole);

  const date = new Date(`${dateStr}T00:00:00`);
  const dow = date.getDay();
  const dowColorClass = dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-zinc-900';
  const heading = `${date.getMonth() + 1}月${date.getDate()}日（${DOW[dow]}）`;

  const dayEvents = useMemo(
    () => events.filter((e) => !e.deleted && e.start_date <= dateStr && e.end_date >= dateStr),
    [events, dateStr],
  );

  const allDaySection = dayEvents.filter(
    (e) => e.all_day || (e.start_date !== e.end_date && e.start_date !== dateStr),
  );

  const timedSection = useMemo(
    () =>
      dayEvents
        .filter((e) => !e.all_day && (e.start_date === e.end_date || e.start_date === dateStr))
        .sort((a, b) => a.start_time.localeCompare(b.start_time)),
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

  const containerHeight = mode === 'schedule' ? 'max-h-[90dvh]' : 'h-[90dvh]';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={backdropClickable ? onClose : undefined}
        aria-hidden="true"
      />

      <div className={`fixed inset-x-0 bottom-0 z-50 flex flex-col bg-white rounded-t-2xl ${containerHeight}`}>
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
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 shrink-0">
              <button
                type="button"
                onClick={onClose}
                aria-label="閉じる"
                className="p-1 text-zinc-400 hover:text-zinc-600"
              >
                <X size={20} strokeWidth={2.5} />
              </button>
              <h2 className={`text-base font-semibold ${dowColorClass}`}>{heading}</h2>
              <button
                type="button"
                onClick={() => { setSwipedEventId(null); setMode('create'); }}
                aria-label="予定を追加"
                className="p-1 text-zinc-600 hover:text-zinc-900"
              >
                <Plus size={22} strokeWidth={2.5} />
              </button>
            </div>

            {/* Event list */}
            <div className="overflow-y-auto pb-8">
              {dayEvents.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <p className="text-sm text-zinc-400">予定はありません</p>
                </div>
              ) : (
                <>
                  {allDaySection.length > 0 && (
                    <div className="px-4 pt-3 pb-3 border-b border-zinc-100">
                      <p className="text-[10px] font-medium text-zinc-400 mb-2">終日・複数日</p>
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

                  {timedSection.length > 0 && (
                    <div className="px-4 pt-3 pb-1 flex flex-col gap-2">
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
                  )}
                </>
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
      {canAction && (
        <div
          className="absolute left-0 top-0 bottom-0 flex items-center justify-center bg-blue-500"
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
      {canAction && (
        <div
          className="absolute right-0 top-0 bottom-0 flex items-center justify-center bg-red-500"
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
        <EventCard event={event} showTime={showTime} />
      </div>
    </div>
  );
}

// ---- EventCard ----

interface EventCardProps {
  event: Event;
  showTime: boolean;
}

function EventCard({ event, showTime }: EventCardProps) {
  const color = FAMILY_COLORS[event.person];
  const timeLabel = showTime ? formatEventTimeRange(event) : '';

  return (
    <div
      style={{ borderLeftColor: color.main, backgroundColor: color.light }}
      className="border-l-[3px] rounded-r-xl px-3 py-2.5"
    >
      {timeLabel && (
        <p className="text-xs font-medium text-zinc-500 mb-1.5 tabular-nums">{timeLabel}</p>
      )}
      <div className="flex items-start gap-1">
        <div className="flex items-baseline gap-1.5 flex-1 min-w-0">
          <span style={{ color: color.main }} className="text-xs font-bold shrink-0">
            {color.label}
          </span>
          <span className="text-sm font-semibold text-zinc-900 leading-snug">{event.title}</span>
        </div>
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
