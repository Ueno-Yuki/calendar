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
const HOURS = Array.from({ length: 24 }, (_, i) => i);
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

  // Read current user from localStorage once on mount
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

  const timedSection = dayEvents.filter(
    (e) => !e.all_day && (e.start_date === e.end_date || e.start_date === dateStr),
  );

  const eventsByHour = useMemo(() => {
    const map = new Map<number, Event[]>();
    for (const e of timedSection) {
      const hour = parseInt(e.start_time.split(':')[0] ?? '0', 10) || 0;
      const list = map.get(hour) ?? [];
      list.push(e);
      map.set(hour, list);
    }
    return map;
  }, [timedSection]);

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
      const res = await apiFetch(
        `/api/events/${eventToDelete.id}?year=${y}&month=${m}`,
        { method: 'DELETE' },
      );
      if (!res.ok) return; // サーバー側エラーは無視して継続
      setEventToDelete(null);
      setSwipedEventId(null);
      onEventDeleted();
    } catch {
      // 通信エラーは無視して確認モーダルを閉じる
      setEventToDelete(null);
      setSwipedEventId(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const canSwipe = (event: Event) => currentRole !== null && event.owner === currentRole;

  // Prevent backdrop from closing modal while create form or delete confirm is open
  const backdropClickable = mode === 'schedule' && eventToDelete === null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={backdropClickable ? onClose : undefined}
        aria-hidden="true"
      />

      {/* Bottom sheet */}
      <div className="fixed inset-x-0 bottom-0 z-50 flex flex-col bg-white rounded-t-2xl max-h-[90dvh]">
        {mode === 'create' ? (
          <EventCreateForm
            dateStr={dateStr}
            onSaved={handleSaved}
            onCancel={() => setMode('schedule')}
          />
        ) : (
          <>
            {/* Schedule header */}
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

            {/* Scrollable schedule body */}
            <div className="overflow-y-auto flex-1 pb-8">
              {allDaySection.length > 0 && (
                <div className="px-4 py-2 border-b border-zinc-100">
                  <p className="text-[10px] text-zinc-400 mb-1.5">終日・複数日</p>
                  <div className="flex flex-col gap-1.5">
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

              <div>
                {HOURS.map((hour) => {
                  const evs = eventsByHour.get(hour) ?? [];
                  return (
                    <div key={hour} className="flex border-b border-zinc-50 min-h-[56px]">
                      <div className="w-14 shrink-0 pt-2 text-right pr-2">
                        <span className="text-[10px] text-zinc-400">
                          {String(hour).padStart(2, '0')}:00
                        </span>
                      </div>
                      <div className="flex-1 py-1 pr-3 flex flex-col gap-1.5">
                        {evs.map((e) => (
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
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Delete confirmation (renders above DayModal sheet) */}
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
    <div className="relative overflow-hidden rounded-lg">
      {/* Delete button (revealed on left swipe) */}
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

      {/* Event card (slides left to reveal delete button) */}
      <div
        style={{
          transform: isSwiped ? `translateX(-${DELETE_BTN_WIDTH}px)` : 'translateX(0)',
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

function EventCard({ event, showTime }: { event: Event; showTime: boolean }) {
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
      className="border-l-[3px] rounded-r-lg px-2.5 py-1.5"
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        {timeLabel && (
          <span className="text-[10px] text-zinc-500 shrink-0">{timeLabel}</span>
        )}
        <span style={{ color: color.main }} className="text-[10px] font-semibold shrink-0">
          {color.label}
        </span>
        <span className="text-sm font-medium text-zinc-900 truncate">{event.title}</span>
      </div>
      {event.location && (
        <p className="text-xs text-zinc-400 mt-0.5 truncate">📍 {event.location}</p>
      )}
    </div>
  );
}
