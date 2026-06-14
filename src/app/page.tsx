'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Event } from '@/types';
import { apiFetch, ApiAuthError } from '@/lib/apiClient';
import CalendarHeader from '@/components/calendar/CalendarHeader';
import CalendarGrid from '@/components/calendar/CalendarGrid';
import DayModal from '@/components/modal/DayModal';
import SettingsModal from '@/components/modal/SettingsModal';

interface EventsResponse {
  events: Event[];
  sync: {
    googleSyncRecommended: boolean;
    lastSyncedAt: string | null;
  };
}

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

  const [showSettings, setShowSettings] = useState(false);

  // Google同期UX状態
  const [isGoogleSyncing, setIsGoogleSyncing] = useState(false);
  const [hasPendingRefresh, setHasPendingRefresh] = useState(false);
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);

  // refでクロージャ内から最新状態を参照する
  const selectedDateRef = useRef<string | null>(null);
  const isSyncingRef = useRef(false);

  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  const cacheRef = useRef<Record<string, Event[]>>({});
  const prevRefreshKeyRef = useRef(0);
  const hasLoadedRef = useRef(false);

  // バックグラウンド同期（POST /api/sync/google）
  // 完了後: 入力中でなければ即リロード、入力中なら保留バナーを表示
  const runGoogleSync = useCallback(() => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    setIsGoogleSyncing(true);

    apiFetch('/api/sync/google', { method: 'POST' })
      .then((res) => (res.ok ? res.json() : null))
      .then((result: { synced?: boolean } | null) => {
        if (!result?.synced) return;
        if (!selectedDateRef.current) {
          // 入力中でない → 即リロード
          setRefreshKey((k) => k + 1);
        } else {
          // 入力中 → 保留
          setHasPendingRefresh(true);
          setShowUpdateBanner(true);
        }
      })
      .catch(() => {})
      .finally(() => {
        isSyncingRef.current = false;
        setIsGoogleSyncing(false);
      });
  }, []);

  useEffect(() => {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const isRefreshTriggered = refreshKey !== prevRefreshKeyRef.current;
    prevRefreshKeyRef.current = refreshKey;

    if (isRefreshTriggered) {
      delete cacheRef.current[key];
    }

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
        return res.json() as Promise<EventsResponse>;
      })
      .then((data) => {
        if (cancelled) return;
        cacheRef.current[key] = data.events;
        setEvents(data.events);
        hasLoadedRef.current = true;

        // 同期推奨の場合はバックグラウンドで Google 同期を実行
        if (data.sync.googleSyncRecommended) {
          runGoogleSync();
        }
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
  }, [year, month, refreshKey, runGoogleSync]);

  const goPrevMonth = () =>
    setYearMonth(({ year: y, month: m }) =>
      m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 },
    );

  const goNextMonth = () =>
    setYearMonth(({ year: y, month: m }) =>
      m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 },
    );

  // DayModal を閉じる時: hasPendingRefresh があればリロード
  const handleDayModalClose = () => {
    setSelectedDate(null);
    if (hasPendingRefresh) {
      setRefreshKey((k) => k + 1);
      setHasPendingRefresh(false);
      setShowUpdateBanner(false);
    }
  };

  // 予定保存・削除後: リロード & 保留状態リセット
  const handleEventCreated = () => {
    setRefreshKey((k) => k + 1);
    setHasPendingRefresh(false);
    setShowUpdateBanner(false);
  };

  const handleEventDeleted = () => {
    setRefreshKey((k) => k + 1);
    setHasPendingRefresh(false);
    setShowUpdateBanner(false);
  };

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
      <CalendarHeader year={year} month={month} syncing={syncing || isGoogleSyncing} onSettingsOpen={() => setShowSettings(true)} />

      {/* 入力中に同期完了した場合の保留バナー */}
      {showUpdateBanner && (
        <div className="px-4 py-1.5 bg-blue-50 text-xs text-blue-600 text-center shrink-0">
          予定が更新されました。保存後に反映されます。
        </div>
      )}

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
          onClose={handleDayModalClose}
          onEventCreated={handleEventCreated}
          onEventDeleted={handleEventDeleted}
        />
      )}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
