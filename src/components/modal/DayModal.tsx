'use client';

import { useState, useMemo, useRef } from 'react';
import type { Event, FamilyRole } from '@/types';
import { FAMILY_COLORS } from '@/lib/colors';
import { STORAGE_KEY } from '@/lib/auth';
import type { StoredUser } from '@/lib/auth';
import { apiFetch } from '@/lib/apiClient';
import EventCreateForm from './EventCreateForm';
import DeleteConfirmModal from './DeleteConfirmModal';

const DOW = ['日', '月', '火', '水', '木', '金', '土'];
const DELETE_BTN_WIDTH = 64; // px

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
  const [mode, setMode] = useState<'schedule' | 'create'>('schedule');
  const [swipedEventId, setSwipedEventId] = useState<string | null>(null);
  const [eventToDelete, setEventToDelete] = useState<Event | null>(null);
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

  // 終日・複数日予定（当日開始でない複数日含む）
  const allDaySection = dayEvents.filter(
    (e) => e.all_day || (e.start_date !== e.end_date && e.start_date !== dateStr),
  );

  // 時刻付き予定を開始時刻昇順でソート
  const timedSection = useMemo(
    () =>
      dayEvents
        .filter((e) => !e.all_day && (e.start_date === e.end_date || e.start_date === dateStr))
        .sort((a, b) => a.start_time.localeCompare(b.start_time)),
    [dayEvents],
  );

  const handleSaved = () => {
    onEventCreated();
    setMode('schedule');
  };

  const handleDeleteRequest = (event: Event) => {
    setEventToDelete(event);
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
      // 論理削除（deleted = TRUE）。物理削除はしない。
      // 将来的に「最近削除した予定」画面を実装し、
      // deleted = TRUE の予定を復元可能にする予定。
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

  const canSwipe = (event: Event) => currentRole !== null && event.owner === currentRole;

  const backdropClickable = mode === 'schedule' && eventToDelete === null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={backdropClickable ? onClose : undefined}
        aria-hidden="true"
      />

      {/* create モード: h-[90dvh] で固定（フォームが flex-1 で埋められるように）
          schedule モード: max-h-[90dvh] でコンテンツ量に応じて可変 */}
      <div className={`fixed inset-x-0 bottom-0 z-50 flex flex-col bg-white rounded-t-2xl ${
        mode === 'create' ? 'h-[90dvh]' : 'max-h-[90dvh]'
      }`}>
        {mode === 'create' ? (
          <EventCreateForm
            dateStr={dateStr}
            onSaved={handleSaved}
            onCancel={() => setMode('schedule')}
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
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
              <h2 className={`text-base font-semibold ${dowColorClass}`}>{heading}</h2>
              <button
                type="button"
                onClick={() => { setSwipedEventId(null); setMode('create'); }}
                aria-label="予定を追加"
                className="p-1 text-zinc-600 hover:text-zinc-900"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            </div>

            {/* Event list — overflow-y-auto makes min-height 0 so container shrinks/scrolls correctly */}
            <div className="overflow-y-auto pb-8">
              {dayEvents.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <p className="text-sm text-zinc-400">予定はありません</p>
                </div>
              ) : (
                <>
                  {/* 終日・複数日 */}
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
                            canDelete={canSwipe(e)}
                            onSwipe={() => setSwipedEventId(e.id)}
                            onCloseSwipe={() => setSwipedEventId(null)}
                            onDeleteRequest={handleDeleteRequest}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 時刻付き予定 */}
                  {timedSection.length > 0 && (
                    <div className="px-4 pt-3 pb-1 flex flex-col gap-2">
                      {timedSection.map((e) => (
                        <SwipeableEventCard
                          key={e.id}
                          event={e}
                          showTime
                          isSwiped={swipedEventId === e.id}
                          canDelete={canSwipe(e)}
                          onSwipe={() => setSwipedEventId(e.id)}
                          onCloseSwipe={() => setSwipedEventId(null)}
                          onDeleteRequest={handleDeleteRequest}
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

      {/* Delete confirmation */}
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

interface SwipeableProps {
  event: Event;
  showTime: boolean;
  isSwiped: boolean;
  canDelete: boolean;
  onSwipe: () => void;
  onCloseSwipe: () => void;
  onDeleteRequest: (event: Event) => void;
}

function SwipeableEventCard({
  event,
  showTime,
  isSwiped,
  canDelete,
  onSwipe,
  onCloseSwipe,
  onDeleteRequest,
}: SwipeableProps) {
  const touchStartX = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (canDelete && dx < -40) {
      onSwipe();
    } else if (dx > 20) {
      onCloseSwipe();
    }
  };

  return (
    <div className="relative overflow-hidden rounded-xl">
      {/* Delete button */}
      {canDelete && (
        <div
          className="absolute right-0 top-0 bottom-0 flex items-center justify-center bg-red-500"
          style={{ width: DELETE_BTN_WIDTH }}
        >
          <button
            type="button"
            onClick={() => onDeleteRequest(event)}
            className="flex items-center justify-center w-full h-full"
            aria-label="削除"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3,6 5,6 21,6" />
              <path d="M19,6l-1,14a2,2,0,0,1-2,2H8a2,2,0,0,1-2-2L5,6" />
              <path d="M10,11v6M14,11v6" />
              <path d="M9,6V4a1,1,0,0,1,1-1h4a1,1,0,0,1,1,1v2" />
            </svg>
          </button>
        </div>
      )}

      {/* Event card (slides left to reveal delete) */}
      <div
        style={{
          transform: isSwiped ? `translateX(-${DELETE_BTN_WIDTH}px)` : 'translateX(0)',
          transition: 'transform 0.2s ease-out',
        }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <EventCard
          event={event}
          showTime={showTime}
          canDelete={canDelete}
          onDeleteRequest={() => onDeleteRequest(event)}
        />
      </div>
    </div>
  );
}

// ---- EventCard ----

interface EventCardProps {
  event: Event;
  showTime: boolean;
  canDelete?: boolean;
  onDeleteRequest?: () => void;
}

function EventCard({ event, showTime, canDelete, onDeleteRequest }: EventCardProps) {
  const color = FAMILY_COLORS[event.person];
  const timeLabel =
    showTime && event.start_time
      ? event.end_time
        ? `${event.start_time}〜${event.end_time}`
        : event.start_time
      : '';

  return (
    <div
      style={{ borderLeftColor: color.main, backgroundColor: color.light }}
      className="border-l-[3px] rounded-r-xl px-3 py-2.5"
    >
      {timeLabel && (
        <p className="text-xs font-medium text-zinc-500 mb-1.5 tabular-nums">{timeLabel}</p>
      )}
      {/* person + title + delete icon */}
      <div className="flex items-start gap-1">
        <div className="flex items-baseline gap-1.5 flex-1 min-w-0">
          <span style={{ color: color.main }} className="text-xs font-bold shrink-0">
            {color.label}
          </span>
          <span className="text-sm font-semibold text-zinc-900 leading-snug">{event.title}</span>
        </div>
        {canDelete && onDeleteRequest && (
          <button
            type="button"
            onClick={onDeleteRequest}
            aria-label="削除"
            className="shrink-0 p-0.5 -mt-0.5 text-zinc-300 hover:text-red-400 active:text-red-500"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3,6 5,6 21,6" />
              <path d="M19,6l-1,14a2,2,0,0,1-2,2H8a2,2,0,0,1-2-2L5,6" />
              <path d="M10,11v6M14,11v6" />
              <path d="M9,6V4a1,1,0,0,1,1-1h4a1,1,0,0,1,1,1v2" />
            </svg>
          </button>
        )}
      </div>
      {event.location && (
        <p className="text-xs text-zinc-500 mt-1 truncate">📍 {event.location}</p>
      )}
      {event.memo && (
        <p className="text-xs text-zinc-400 mt-0.5 line-clamp-2 whitespace-pre-line">
          {event.memo}
        </p>
      )}
    </div>
  );
}
