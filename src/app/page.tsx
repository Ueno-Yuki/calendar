'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Event } from '@/types';
import { apiFetch, ApiAuthError } from '@/lib/apiClient';
import CalendarHeader from '@/components/calendar/CalendarHeader';
import CalendarGrid from '@/components/calendar/CalendarGrid';
import DayModal from '@/components/modal/DayModal';
import SettingsModal from '@/components/modal/SettingsModal';
import NotificationPromptModal, {
  NOTIFICATION_PROMPT_DISMISSED_KEY,
} from '@/components/modal/NotificationPromptModal';
import YearMonthPickerModal from '@/components/modal/YearMonthPickerModal';

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
  // 通知タップ時の /?date=YYYY-MM-DD パラメータで自動表示する日付
  const [pendingDate, setPendingDate] = useState<string | null>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [showYearMonthPicker, setShowYearMonthPicker] = useState(false);
  const [showNotificationPrompt, setShowNotificationPrompt] = useState(false);
  const notificationPromptCheckedRef = useRef(false);

  // Google同期UX状態
  const [isGoogleSyncing, setIsGoogleSyncing] = useState(false);
  const [hasPendingRefresh, setHasPendingRefresh] = useState(false);
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);

  // refでクロージャ内から最新状態を参照する
  const selectedDateRef = useRef<string | null>(null);
  const isSyncingRef = useRef(false);
  // undefined = 未初期化, null = サーバー未設定, string = ISO日時
  const knownLastUpdatedAtRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  // 通知タップ時の date パラメータを読み取り、対象月へ移動してDayModalを予約する
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const dateParam = params.get('date');
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      const [y, m] = dateParam.split('-').map(Number);
      setPendingDate(dateParam);
      setYearMonth({ year: y, month: m });
      // URLを即座にクリーンアップ
      window.history.replaceState({}, '', '/');
    }
  }, []);

  // イベント読み込み完了後に pendingDate の DayModal を開く
  useEffect(() => {
    if (!pendingDate || loading) return;
    setSelectedDate(pendingDate);
    setPendingDate(null);
  }, [pendingDate, loading]);

  // 認証済み・初回ロード完了後に通知許可プロンプトを表示するか判定する。
  // Notification.requestPermission() はユーザー操作（ボタンタップ）に紐づけて呼ぶため、ここでは表示判定のみ。
  useEffect(() => {
    if (loading || authError) return;
    if (notificationPromptCheckedRef.current) return;
    notificationPromptCheckedRef.current = true;

    // 通知API・SW・PushManagerのブラウザ対応チェック
    if (
      !('Notification' in window) ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      Notification.permission !== 'default' ||
      localStorage.getItem(NOTIFICATION_PROMPT_DISMISSED_KEY) === '1'
    ) {
      return;
    }

    // permission=default なら push 購読は存在しないが、仕様に従い明示確認する
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (!sub) setShowNotificationPrompt(true);
      })
      .catch(() => {
        // SW 準備中などでエラーの場合もプロンプトを表示する
        setShowNotificationPrompt(true);
      });
  }, [loading, authError]);

  const cacheRef = useRef<Record<string, Event[]>>({});
  const prevRefreshKeyRef = useRef(0);
  const hasLoadedRef = useRef(false);

  // 自分の操作後に knownLastUpdatedAt をサーバーと同期し、次のポーリングで誤検知しないようにする
  const refreshKnownLastUpdated = useCallback(async () => {
    try {
      const res = await apiFetch('/api/events/last-updated');
      if (res.ok) {
        const data = (await res.json()) as { lastUpdatedAt: string | null };
        knownLastUpdatedAtRef.current = data.lastUpdatedAt;
      }
    } catch {
      // ignore
    }
  }, []);

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

  // 30秒ポーリング: 他の家族の予定変更を検知してリロードまたは保留する
  useEffect(() => {
    if (authError || loading) return;

    let cancelled = false;

    const poll = async () => {
      if (cancelled || document.hidden) return;
      try {
        const res = await apiFetch('/api/events/last-updated');
        if (!res.ok || cancelled) return;
        const { lastUpdatedAt } = (await res.json()) as { lastUpdatedAt: string | null };

        // 初回ポーリング: 現在値を記録するだけ
        if (knownLastUpdatedAtRef.current === undefined) {
          knownLastUpdatedAtRef.current = lastUpdatedAt;
          return;
        }

        // 更新検知: null でなく、既知値より新しい場合のみ
        const isNewer =
          lastUpdatedAt !== null &&
          lastUpdatedAt !== knownLastUpdatedAtRef.current &&
          (knownLastUpdatedAtRef.current === null || lastUpdatedAt > knownLastUpdatedAtRef.current);

        if (!isNewer) return;
        knownLastUpdatedAtRef.current = lastUpdatedAt;

        if (selectedDateRef.current) {
          // DayModal 表示中 → 保留
          setHasPendingRefresh(true);
          setShowUpdateBanner(true);
        } else {
          // 通常時 → 即リロード（バナーなし）
          setRefreshKey((k) => k + 1);
        }
      } catch {
        // ネットワークエラー等は無視
      }
    };

    const intervalId = setInterval(poll, 30_000);

    const handleVisibilityChange = () => {
      if (!document.hidden) poll(); // タブ復帰時に即ポーリング
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    poll(); // 起動直後に初回ポーリング

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [authError, loading]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // refreshKnownLastUpdated で自分の操作を knownLastUpdatedAt に反映し、次のポーリングで二重リロードしない
  const handleEventCreated = () => {
    setRefreshKey((k) => k + 1);
    setHasPendingRefresh(false);
    setShowUpdateBanner(false);
    refreshKnownLastUpdated();
  };

  const handleEventDeleted = () => {
    setRefreshKey((k) => k + 1);
    setHasPendingRefresh(false);
    setShowUpdateBanner(false);
    refreshKnownLastUpdated();
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
      <CalendarHeader
        year={year}
        month={month}
        syncing={syncing || isGoogleSyncing}
        onSettingsOpen={() => setShowSettings(true)}
        onYearMonthPress={() => setShowYearMonthPicker(true)}
      />

      {/* 他の家族の更新を保留中のバナー */}
      {showUpdateBanner && (
        <div className="px-4 py-1.5 bg-blue-50 text-xs text-blue-600 text-center shrink-0">
          他の家族が予定を更新しました。閉じると反映されます。
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
      {showYearMonthPicker && (
        <YearMonthPickerModal
          currentYear={year}
          currentMonth={month}
          onConfirm={(y, m) => setYearMonth({ year: y, month: m })}
          onClose={() => setShowYearMonthPicker(false)}
        />
      )}
      {showNotificationPrompt && (
        <NotificationPromptModal onClose={() => setShowNotificationPrompt(false)} />
      )}
    </div>
  );
}
