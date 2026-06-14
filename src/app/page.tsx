'use client';

import { useState, useEffect, useRef } from 'react';
import type { Event } from '@/types';
import { apiFetch, ApiAuthError } from '@/lib/apiClient';
import CalendarHeader from '@/components/calendar/CalendarHeader';
import CalendarGrid from '@/components/calendar/CalendarGrid';
import DayModal from '@/components/modal/DayModal';

function getInitialYearMonth() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export default function CalendarPage() {
  const [{ year, month }, setYearMonth] = useState(getInitialYearMonth);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true); // 初回ロードのみ全画面オーバーレイ
  const [syncing, setSyncing] = useState(false); // 月切り替え時のヘッダースピナー
  const [authError, setAuthError] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const cacheRef = useRef<Record<string, Event[]>>({});
  const prevRefreshKeyRef = useRef(0);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const isRefreshTriggered = refreshKey !== prevRefreshKeyRef.current;
    prevRefreshKeyRef.current = refreshKey;

    // 予定作成・削除後はキャッシュを無効化して再取得する
    if (isRefreshTriggered) {
      delete cacheRef.current[key];
    }

    // キャッシュヒット: 月切り替えのみ（refreshKey 起因の再取得は除く）
    if (!isRefreshTriggered && cacheRef.current[key]) {
      setEvents(cacheRef.current[key]);
      return;
    }

    if (!hasLoadedRef.current) {
      setLoading(true);
    } else {
      setSyncing(true);
    }

    let cancelled = false;
    apiFetch(`/api/events?year=${year}&month=${month}`)
      .then((res) => {
        if (!res.ok) throw new Error('fetch failed');
        return res.json() as Promise<Event[]>;
      })
      .then((data) => {
        if (cancelled) return;
        cacheRef.current[key] = data;
        setEvents(data);
        hasLoadedRef.current = true;
      })
      .catch((err: unknown) => {
        if (err instanceof ApiAuthError) setAuthError(true);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setSyncing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [year, month, refreshKey]);

  const goPrevMonth = () =>
    setYearMonth(({ year: y, month: m }) =>
      m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 },
    );

  const goNextMonth = () =>
    setYearMonth(({ year: y, month: m }) =>
      m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 },
    );

  if (authError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <p className="text-center text-sm text-zinc-500">
          家族から共有されたURLからアクセスしてください。
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[100dvh] bg-white" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <CalendarHeader year={year} month={month} syncing={syncing} />
      <CalendarGrid
        year={year}
        month={month}
        events={events}
        loading={loading}
        onPrevMonth={goPrevMonth}
        onNextMonth={goNextMonth}
        onDayPress={(dateStr) => setSelectedDate(dateStr)}
      />
      {selectedDate && (
        <DayModal
          dateStr={selectedDate}
          events={events}
          onClose={() => setSelectedDate(null)}
          onEventCreated={() => setRefreshKey((k) => k + 1)}
          onEventDeleted={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
