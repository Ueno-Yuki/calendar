'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Event, FamilyRole } from '@/types';
import { apiFetch, ApiAuthError } from '@/lib/apiClient';
import { STORAGE_KEY } from '@/lib/auth';
import type { StoredUser } from '@/lib/auth';
import CalendarHeader from '@/components/calendar/CalendarHeader';
import CalendarGrid from '@/components/calendar/CalendarGrid';
import DayModal from '@/components/modal/DayModal';
import GoogleSyncPreviewModal, {
  type GoogleSyncPreview,
} from '@/components/modal/GoogleSyncPreviewModal';
import SettingsModal from '@/components/modal/SettingsModal';
import NotificationPromptModal, {
  NOTIFICATION_PROMPT_DISMISSED_KEY,
} from '@/components/modal/NotificationPromptModal';
import YearMonthPickerModal from '@/components/modal/YearMonthPickerModal';

interface EventsResponse {
  events: Event[];
}

interface GoogleStatusResponse {
  connected: boolean;
  syncDisabled: boolean;
}

function canUseGoogleSync(role: FamilyRole | null): boolean {
  return role === 'mother' || role === 'me';
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
  const [currentRole, setCurrentRole] = useState<FamilyRole | null>(null);
  const notificationPromptCheckedRef = useRef(false);

  // ポーリング・手動更新UX状態
  const [knownLastUpdatedAt, setKnownLastUpdatedAt] = useState<string | null | undefined>(undefined);
  const [hasRemoteUpdates, setHasRemoteUpdates] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRefreshBlocked, setIsRefreshBlocked] = useState(false);
  const [isGoogleSyncing, setIsGoogleSyncing] = useState(false);
  const [isGooglePreviewLoading, setIsGooglePreviewLoading] = useState(false);
  const [googleSyncDisabled, setGoogleSyncDisabled] = useState(false);
  const [googleSyncPreview, setGoogleSyncPreview] = useState<GoogleSyncPreview | null>(null);
  const [selectedGoogleEventIds, setSelectedGoogleEventIds] = useState<string[]>([]);
  const [expandedGoogleCategoryIds, setExpandedGoogleCategoryIds] = useState<string[]>([]);
  const [googleSyncMessage, setGoogleSyncMessage] = useState('');
  const [googleSyncError, setGoogleSyncError] = useState('');
  const [googleSyncModalError, setGoogleSyncModalError] = useState('');

  // refでクロージャ内から最新状態を参照する
  const isRefreshBlockedRef = useRef(false);
  const knownLastUpdatedAtRef = useRef<string | null | undefined>(undefined);
  const refreshCompletionRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    knownLastUpdatedAtRef.current = knownLastUpdatedAt;
  }, [knownLastUpdatedAt]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCurrentRole(readCurrentRole());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!canUseGoogleSync(currentRole)) {
      return;
    }

    let cancelled = false;
    apiFetch('/api/auth/google/status')
      .then((res) => (res.ok ? (res.json() as Promise<GoogleStatusResponse>) : null))
      .then((data) => {
        if (cancelled || !data) return;
        setGoogleSyncDisabled(!data.connected || data.syncDisabled);
      })
      .catch(() => {
        if (!cancelled) setGoogleSyncDisabled(true);
      });

    return () => {
      cancelled = true;
    };
  }, [currentRole]);

  useEffect(() => {
    isRefreshBlockedRef.current = isRefreshBlocked;
  }, [isRefreshBlocked]);

  useEffect(() => {
    if (!googleSyncMessage && !googleSyncError) return;
    const timer = window.setTimeout(() => {
      setGoogleSyncMessage('');
      setGoogleSyncError('');
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [googleSyncError, googleSyncMessage]);

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

  const fetchLastUpdatedAt = useCallback(async (): Promise<string | null | undefined> => {
    try {
      const res = await apiFetch('/api/events/last-updated');
      if (res.ok) {
        const data = (await res.json()) as { lastUpdatedAt: string | null };
        return data.lastUpdatedAt;
      }
    } catch {
      // ignore
    }
    return undefined;
  }, []);

  const setKnownLastUpdated = useCallback((value: string | null) => {
    knownLastUpdatedAtRef.current = value;
    setKnownLastUpdatedAt(value);
  }, []);

  // 自分の操作後に knownLastUpdatedAt をサーバーと同期し、次のポーリングで誤検知しないようにする
  const refreshKnownLastUpdated = useCallback(async () => {
    const latest = await fetchLastUpdatedAt();
    if (latest !== undefined) setKnownLastUpdated(latest);
  }, [fetchLastUpdatedAt, setKnownLastUpdated]);

  const reloadEvents = useCallback((): Promise<void> => {
    setRefreshKey((k) => k + 1);
    return new Promise((resolve) => {
      refreshCompletionRef.current = resolve;
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
      })
      .catch((err: unknown) => {
        if (err instanceof ApiAuthError) setAuthError(true);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setSyncing(false);
          refreshCompletionRef.current?.();
          refreshCompletionRef.current = null;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [year, month, refreshKey]);

  // 30秒ポーリング: 他の家族の予定変更を検知する（ここでは自動更新しない）
  useEffect(() => {
    if (authError || loading) return;

    let cancelled = false;

    const poll = async () => {
      if (cancelled || document.hidden) return;
      try {
        const lastUpdatedAt = await fetchLastUpdatedAt();
        if (lastUpdatedAt === undefined || cancelled) return;

        // 初回ポーリング: 現在値を記録するだけ
        if (knownLastUpdatedAtRef.current === undefined) {
          setKnownLastUpdated(lastUpdatedAt);
          return;
        }

        // 更新検知: null でなく、既知値より新しい場合のみ
        const isNewer =
          lastUpdatedAt !== null &&
          lastUpdatedAt !== knownLastUpdatedAtRef.current &&
          (knownLastUpdatedAtRef.current === null || lastUpdatedAt > knownLastUpdatedAtRef.current);

        if (!isNewer) return;
        setHasRemoteUpdates(true);
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
  }, [authError, fetchLastUpdatedAt, loading, setKnownLastUpdated]);

  const goPrevMonth = () =>
    setYearMonth(({ year: y, month: m }) =>
      m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 },
    );

  const goNextMonth = () =>
    setYearMonth(({ year: y, month: m }) =>
      m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 },
    );

  const handleDayModalClose = () => {
    setSelectedDate(null);
    isRefreshBlockedRef.current = false;
    setIsRefreshBlocked(false);
  };

  // 予定保存・削除後: 自分の操作は即時反映し、ポーリングの既知値を更新する
  // refreshKnownLastUpdated で自分の操作を knownLastUpdatedAt に反映し、次のポーリングで二重リロードしない
  const handleEventCreated = () => {
    void reloadEvents();
    setHasRemoteUpdates(false);
    refreshKnownLastUpdated();
  };

  const handleEventDeleted = () => {
    void reloadEvents();
    setHasRemoteUpdates(false);
    refreshKnownLastUpdated();
  };

  const handleRefreshBlockChange = useCallback((blocked: boolean) => {
    isRefreshBlockedRef.current = blocked;
    setIsRefreshBlocked(blocked);
  }, []);

  const handleManualRefresh = useCallback(async () => {
    if (isRefreshBlockedRef.current || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await reloadEvents();
      const latest = await fetchLastUpdatedAt();
      if (latest !== undefined) setKnownLastUpdated(latest);
      setHasRemoteUpdates(false);
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchLastUpdatedAt, isRefreshing, reloadEvents, setKnownLastUpdated]);

  const handleHeaderGoogleSync = useCallback(async () => {
    if (!canUseGoogleSync(currentRole) || googleSyncDisabled || isGooglePreviewLoading || isGoogleSyncing) return;

    setIsGooglePreviewLoading(true);
    setGoogleSyncMessage('');
    setGoogleSyncError('');
    setGoogleSyncModalError('');
    try {
      const res = await apiFetch('/api/sync/google/preview');
      const data = (await res.json().catch(() => null)) as
        | GoogleSyncPreview
        | { reason?: string }
        | null;

      if (!res.ok) {
        const reason = data && 'reason' in data ? data.reason : undefined;
        setGoogleSyncError(reason === 'forbidden' ? '同期権限がありません' : '同期プレビューに失敗しました');
        return;
      }

      if (data && 'reason' in data && data.reason === 'sync_disabled') {
        setGoogleSyncError('Google同期は停止中です');
        return;
      }
      if (data && 'reason' in data && data.reason === 'not_connected') {
        setGoogleSyncError('Googleカレンダーが未連携です');
        return;
      }

      if (data && 'ok' in data && data.ok) {
        setGoogleSyncPreview(data);
        setSelectedGoogleEventIds([]);
        setExpandedGoogleCategoryIds([]);
      } else {
        setGoogleSyncError('同期プレビューに失敗しました');
      }
    } catch {
      setGoogleSyncError('同期プレビューに失敗しました');
    } finally {
      setIsGooglePreviewLoading(false);
    }
  }, [currentRole, googleSyncDisabled, isGooglePreviewLoading, isGoogleSyncing]);

  const handleToggleGoogleCategory = useCallback((categoryId: string) => {
    if (!googleSyncPreview) return;
    const category = googleSyncPreview.categories.find((item) => item.categoryId === categoryId);
    if (!category) return;
    const categoryEventIds = category.events.map((event) => event.googleEventId);

    setSelectedGoogleEventIds((current) => {
      const currentSet = new Set(current);
      const allSelected = categoryEventIds.every((id) => currentSet.has(id));
      if (allSelected) {
        categoryEventIds.forEach((id) => currentSet.delete(id));
      } else {
        categoryEventIds.forEach((id) => currentSet.add(id));
      }
      return [...currentSet];
    });
  }, [googleSyncPreview]);

  const handleToggleGoogleCategoryExpanded = useCallback((categoryId: string) => {
    setExpandedGoogleCategoryIds((current) =>
      current.includes(categoryId)
        ? current.filter((id) => id !== categoryId)
        : [...current, categoryId],
    );
  }, []);

  const handleToggleGoogleEvent = useCallback((googleEventId: string) => {
    setSelectedGoogleEventIds((current) =>
      current.includes(googleEventId)
        ? current.filter((id) => id !== googleEventId)
        : [...current, googleEventId],
    );
  }, []);

  const handleCloseGooglePreview = useCallback(() => {
    if (isGoogleSyncing) return;
    setGoogleSyncPreview(null);
    setSelectedGoogleEventIds([]);
    setExpandedGoogleCategoryIds([]);
    setGoogleSyncModalError('');
  }, [isGoogleSyncing]);

  const handleConfirmGoogleSync = useCallback(async () => {
    if (selectedGoogleEventIds.length === 0 || isGoogleSyncing) return;

    setIsGoogleSyncing(true);
    setGoogleSyncModalError('');
    setGoogleSyncMessage('');
    setGoogleSyncError('');
    try {
      const res = await apiFetch('/api/sync/google', {
        method: 'POST',
        body: JSON.stringify({ eventIds: selectedGoogleEventIds }),
      });
      const data = (await res.json().catch(() => null)) as { reason?: string } | null;

      if (!res.ok) {
        setGoogleSyncModalError(data?.reason === 'no_events_selected' ? '取り込む予定を選択してください' : 'Google同期に失敗しました');
        return;
      }

      if (data?.reason === 'sync_disabled') {
        setGoogleSyncModalError('Google同期は停止中です');
        return;
      }
      if (data?.reason === 'not_connected') {
        setGoogleSyncModalError('Googleカレンダーが未連携です');
        return;
      }
      if (data?.reason === 'too_soon') {
        setGoogleSyncMessage('直近で同期済みです');
      } else {
        setGoogleSyncMessage('Google同期しました');
      }

      setGoogleSyncPreview(null);
      setSelectedGoogleEventIds([]);
      setExpandedGoogleCategoryIds([]);
      await reloadEvents();
      setHasRemoteUpdates(false);
      refreshKnownLastUpdated();
    } catch {
      setGoogleSyncModalError('Google同期に失敗しました');
    } finally {
      setIsGoogleSyncing(false);
    }
  }, [isGoogleSyncing, refreshKnownLastUpdated, reloadEvents, selectedGoogleEventIds]);

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
        syncing={syncing}
        hasRemoteUpdates={hasRemoteUpdates}
        isRefreshing={isRefreshing}
        refreshDisabled={isRefreshBlocked}
        showGoogleSync={canUseGoogleSync(currentRole)}
        isGoogleSyncing={isGooglePreviewLoading || isGoogleSyncing}
        googleSyncDisabled={googleSyncDisabled}
        onGoogleSync={handleHeaderGoogleSync}
        onRefresh={handleManualRefresh}
        onSettingsOpen={() => setShowSettings(true)}
        onYearMonthPress={() => setShowYearMonthPicker(true)}
      />
      {(googleSyncMessage || googleSyncError) && (
        <div className="pointer-events-none fixed left-1/2 top-14 z-30 -translate-x-1/2 px-4">
          <p
            className={`rounded-full px-3 py-1.5 text-xs font-medium shadow-sm ${
              googleSyncError
                ? 'bg-red-50 text-red-600 ring-1 ring-red-100'
                : 'bg-zinc-900 text-white'
            }`}
          >
            {googleSyncError || googleSyncMessage}
          </p>
        </div>
      )}

      <CalendarGrid
        year={year}
        month={month}
        events={events}
        loading={loading}
        onPrevMonth={goPrevMonth}
        onNextMonth={goNextMonth}
        onRefresh={handleManualRefresh}
        refreshDisabled={isRefreshBlocked || isRefreshing}
        onDayPress={(dateStr) => setSelectedDate(dateStr)}
      />
      {selectedDate && (
        <DayModal
          dateStr={selectedDate}
          events={events}
          onClose={handleDayModalClose}
          onEventCreated={handleEventCreated}
          onEventDeleted={handleEventDeleted}
          onRefreshBlockChange={handleRefreshBlockChange}
        />
      )}
      {googleSyncPreview && (
        <GoogleSyncPreviewModal
          preview={googleSyncPreview}
          selectedEventIds={selectedGoogleEventIds}
          expandedCategoryIds={expandedGoogleCategoryIds}
          syncing={isGoogleSyncing}
          error={googleSyncModalError}
          onToggleCategory={handleToggleGoogleCategory}
          onToggleCategoryExpanded={handleToggleGoogleCategoryExpanded}
          onToggleEvent={handleToggleGoogleEvent}
          onClose={handleCloseGooglePreview}
          onConfirm={handleConfirmGoogleSync}
        />
      )}
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onGoogleSyncRequest={() => {
            setShowSettings(false);
            void handleHeaderGoogleSync();
          }}
        />
      )}
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
