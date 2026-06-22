'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Event, FamilyRole } from '@/types';
import { apiFetch, ApiAuthError } from '@/lib/apiClient';
import { STORAGE_KEY } from '@/lib/auth';
import type { StoredUser } from '@/lib/auth';
import CalendarHeader from '@/components/calendar/CalendarHeader';
import CalendarGrid from '@/components/calendar/CalendarGrid';
import DayModal from '@/components/modal/DayModal';
import GoogleReverseSyncPreviewModal, {
  googleReversePairKey,
  type GoogleReverseSyncPreview,
  type GoogleReverseUpdateCandidate,
} from '@/components/modal/GoogleReverseSyncPreviewModal';
import GoogleSyncModeModal from '@/components/modal/GoogleSyncModeModal';
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
  partial?: boolean;
  failedSheets?: string[];
  reason?: string;
}

interface GoogleStatusResponse {
  connected: boolean;
  syncDisabled: boolean;
}

interface EventsCacheEntry {
  events: Event[];
  fetchedAt: string;
  eventsLastUpdatedAt: string | null;
}

type RefreshCompletion = {
  resolve: () => void;
  reject: (error: Error) => void;
};

const EVENTS_CACHE_PREFIX = 'events:';
const EVENTS_FETCH_DEBOUNCE_MS = 400;
const POLLING_START_DELAY_MS = 5_000;
const EVENTS_QUOTA_ERROR_MESSAGE = '一時的に予定を取得できません。少し待って再試行してください';

type InFlightEventsRequest = {
  promise: Promise<EventsResponse>;
  controller: AbortController;
};

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

function readDateParam(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const dateParam = params.get('date');
  return dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null;
}

function getInitialRouteState() {
  const dateParam = readDateParam();
  if (!dateParam) {
    return { ...getInitialYearMonth(), pendingDate: null as string | null };
  }

  const [year, month] = dateParam.split('-').map(Number);
  return { year, month, pendingDate: dateParam };
}

function getEventsCacheKey(year: number, month: number): string {
  return `${EVENTS_CACHE_PREFIX}${year}-${String(month).padStart(2, '0')}`;
}

function readEventsCache(year: number, month: number): EventsCacheEntry | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(getEventsCacheKey(year, month));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EventsCacheEntry>;
    if (!Array.isArray(parsed.events) || typeof parsed.fetchedAt !== 'string') return null;
    return {
      events: parsed.events as Event[],
      fetchedAt: parsed.fetchedAt,
      eventsLastUpdatedAt: typeof parsed.eventsLastUpdatedAt === 'string' ? parsed.eventsLastUpdatedAt : null,
    };
  } catch {
    return null;
  }
}

function writeEventsCache(
  year: number,
  month: number,
  events: Event[],
  eventsLastUpdatedAt: string | null,
): void {
  if (typeof window === 'undefined') return;
  try {
    const entry: EventsCacheEntry = {
      events,
      fetchedAt: new Date().toISOString(),
      eventsLastUpdatedAt,
    };
    localStorage.setItem(getEventsCacheKey(year, month), JSON.stringify(entry));
  } catch {
    // ignore localStorage errors
  }
}

function getEventsFetchErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (
    message.includes('status=429') ||
    message.includes('quota_exceeded') ||
    message.includes('Quota exceeded') ||
    message.includes('Read requests per minute')
  ) {
    return EVENTS_QUOTA_ERROR_MESSAGE;
  }
  return '予定の読み込みに失敗しました';
}

export default function CalendarPage() {
  const [initialRouteState] = useState(getInitialRouteState);
  const [{ year, month }, setYearMonth] = useState(() => ({
    year: initialRouteState.year,
    month: initialRouteState.month,
  }));
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false); // 月切り替え時のヘッダースピナー
  const [authError, setAuthError] = useState(false);
  const [eventsLoadError, setEventsLoadError] = useState('');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // 通知タップ時の /?date=YYYY-MM-DD パラメータで一度だけ消費する日付
  const pendingDateRef = useRef<string | null>(initialRouteState.pendingDate);

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
  const [showGoogleSyncMode, setShowGoogleSyncMode] = useState(false);
  const [googleSyncPreview, setGoogleSyncPreview] = useState<GoogleSyncPreview | null>(null);
  const [selectedGoogleEventIds, setSelectedGoogleEventIds] = useState<string[]>([]);
  const [expandedGoogleCategoryIds, setExpandedGoogleCategoryIds] = useState<string[]>([]);
  const [googleReverseSyncPreview, setGoogleReverseSyncPreview] = useState<GoogleReverseSyncPreview | null>(null);
  const [selectedReverseCreateIds, setSelectedReverseCreateIds] = useState<string[]>([]);
  const [selectedReverseUpdatePairKeys, setSelectedReverseUpdatePairKeys] = useState<string[]>([]);
  const [selectedReverseCreateColorIds, setSelectedReverseCreateColorIds] = useState<Record<string, string>>({});
  const [selectedReverseUpdateColorIds, setSelectedReverseUpdateColorIds] = useState<Record<string, string>>({});
  const [googleSyncMessage, setGoogleSyncMessage] = useState('');
  const [googleSyncError, setGoogleSyncError] = useState('');
  const [googleSyncModalError, setGoogleSyncModalError] = useState('');

  // refでクロージャ内から最新状態を参照する
  const isRefreshBlockedRef = useRef(false);
  const knownLastUpdatedAtRef = useRef<string | null | undefined>(undefined);
  const refreshCompletionRef = useRef<RefreshCompletion | null>(null);

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

  useEffect(() => {
    if (pendingDateRef.current) {
      window.history.replaceState({}, '', '/');
    }
  }, []);

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
  const failedMonthKeysRef = useRef<Set<string>>(new Set());
  const inFlightEventsRef = useRef<Map<string, InFlightEventsRequest>>(new Map());
  const activeEventFetchCountRef = useRef(0);
  const [isEventsFetching, setIsEventsFetching] = useState(false);

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
    return new Promise((resolve, reject) => {
      refreshCompletionRef.current?.reject(new Error('reload superseded'));
      refreshCompletionRef.current = { resolve, reject };
      setRefreshKey((k) => k + 1);
    });
  }, []);

  useEffect(() => {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const requestUrl = `/api/events?year=${year}&month=${month}`;
    const startedAt = performance.now();
    const currentRefreshKey = refreshKey;
    const isRefreshTriggered = refreshKey !== prevRefreshKeyRef.current;
    const refreshRequest = isRefreshTriggered ? refreshCompletionRef.current : null;
    prevRefreshKeyRef.current = refreshKey;
    const wasLoadedBeforeCache = hasLoadedRef.current;
    const cachedEvents = !isRefreshTriggered ? cacheRef.current[key] : undefined;
    const localCacheStartedAt = performance.now();
    const localCachedEntry = !isRefreshTriggered && !cachedEvents ? readEventsCache(year, month) : null;
    if (localCachedEntry) {
      console.info('[perf:cache:load]', {
        key,
        ms: Math.round(performance.now() - localCacheStartedAt),
        count: localCachedEntry.events.length,
      });
    }
    const shouldUseCache = !isRefreshTriggered && (cachedEvents !== undefined || localCachedEntry !== null);

    if (cachedEvents !== undefined) {
      console.info('[events:cache-hit]', key);
      setEventsLoadError('');
      setEvents(cachedEvents);
      hasLoadedRef.current = true;
      if (pendingDateRef.current) {
        setSelectedDate(pendingDateRef.current);
        pendingDateRef.current = null;
      }
    } else if (localCachedEntry) {
      console.info('[events:local-cache-hit]', key);
      cacheRef.current[key] = localCachedEntry.events;
      setEventsLoadError('');
      setEvents(localCachedEntry.events);
      hasLoadedRef.current = true;
      if (pendingDateRef.current) {
        setSelectedDate(pendingDateRef.current);
        pendingDateRef.current = null;
      }
    }

    setLoading(!hasLoadedRef.current && !shouldUseCache);
    setSyncing(true);

    let cancelled = false;
    const debounceMs = !isRefreshTriggered && wasLoadedBeforeCache ? EVENTS_FETCH_DEBOUNCE_MS : 0;
    const timer = window.setTimeout(() => {
      if (cancelled) return;

      for (const [inFlightKey, request] of inFlightEventsRef.current.entries()) {
        if (inFlightKey !== key) {
          request.controller.abort();
          inFlightEventsRef.current.delete(inFlightKey);
        }
      }

      let inFlight = inFlightEventsRef.current.get(key);
      if (!inFlight) {
        const controller = new AbortController();
        console.info('[events:start]', key);
        activeEventFetchCountRef.current += 1;
        setIsEventsFetching(true);
        const promise = apiFetch(requestUrl, { signal: controller.signal })
          .then(async (res) => {
            if (!res.ok) {
              const body = await res.text().catch(() => '');
              throw new Error(`fetch failed status=${res.status} body=${body}`);
            }
            return res.json() as Promise<EventsResponse>;
          })
          .finally(() => {
            inFlightEventsRef.current.delete(key);
            activeEventFetchCountRef.current = Math.max(0, activeEventFetchCountRef.current - 1);
            setIsEventsFetching(activeEventFetchCountRef.current > 0);
          });
        inFlight = { promise, controller };
        inFlightEventsRef.current.set(key, inFlight);
      } else {
        console.info('[events:dedupe]', key);
      }

      inFlight.promise
        .then((data) => {
          if (cancelled) return;
          console.info('[events:success]', {
            key,
            count: data.events.length,
            partial: Boolean(data.partial),
            failedSheets: data.failedSheets ?? [],
          });
          console.info('[perf:events:render-scheduled]', {
            key,
            ms: Math.round(performance.now() - startedAt),
          });
          cacheRef.current[key] = data.events;
          writeEventsCache(year, month, data.events, knownLastUpdatedAtRef.current ?? null);
          failedMonthKeysRef.current.delete(key);
          setEventsLoadError('');
          setEvents(data.events);
          if (pendingDateRef.current) {
            setSelectedDate(pendingDateRef.current);
            pendingDateRef.current = null;
          }
          hasLoadedRef.current = true;
          if (refreshRequest && refreshCompletionRef.current === refreshRequest) {
            refreshRequest.resolve();
            refreshCompletionRef.current = null;
          }
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const errorMessage = err instanceof Error ? err.message : 'unknown error';
          failedMonthKeysRef.current.add(key);
          console.error('[events:fail]', key, err);
          console.error('[events:reload] fetch failed', {
            year,
            month,
            refreshKey: currentRefreshKey,
            requestUrl,
            errorMessage,
          });
          if (err instanceof ApiAuthError) setAuthError(true);
          setEventsLoadError(getEventsFetchErrorMessage(err));
          if (refreshRequest && refreshCompletionRef.current === refreshRequest) {
            refreshRequest.reject(new Error(errorMessage));
            refreshCompletionRef.current = null;
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
            setSyncing(false);
          }
        });
    }, debounceMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (refreshRequest && refreshCompletionRef.current === refreshRequest) {
        refreshRequest.reject(new Error('reload cancelled'));
        refreshCompletionRef.current = null;
      }
    };
  }, [year, month, refreshKey]);

  // 30秒ポーリング: 他の家族の予定変更を検知する（ここでは自動更新しない）
  useEffect(() => {
    if (authError || loading || syncing || isEventsFetching) return;

    let cancelled = false;

    const poll = async () => {
      if (cancelled || document.hidden || activeEventFetchCountRef.current > 0) return;
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

    const startupPollTimer = window.setTimeout(poll, POLLING_START_DELAY_MS);
    const intervalId = setInterval(poll, 30_000);

    const handleVisibilityChange = () => {
      if (!document.hidden) poll(); // タブ復帰時に即ポーリング
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearTimeout(startupPollTimer);
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [authError, fetchLastUpdatedAt, isEventsFetching, loading, setKnownLastUpdated, syncing]);

  const goPrevMonth = () =>
    setYearMonth(({ year: y, month: m }) =>
      m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 },
    );

  const goNextMonth = () =>
    setYearMonth(({ year: y, month: m }) =>
      m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 },
    );

  const handleGoToToday = useCallback(() => {
    const today = getInitialYearMonth();
    if (year === today.year && month === today.month) return;
    setYearMonth(today);
  }, [month, year]);

  const handleDayModalClose = () => {
    setSelectedDate(null);
    isRefreshBlockedRef.current = false;
    setIsRefreshBlocked(false);
  };

  // 予定保存・削除後: 自分の操作は即時反映し、ポーリングの既知値を更新する
  // refreshKnownLastUpdated で自分の操作を knownLastUpdatedAt に反映し、次のポーリングで二重リロードしない
  const handleEventCreated = () => {
    void reloadEvents()
      .then(() => {
        setHasRemoteUpdates(false);
        return refreshKnownLastUpdated();
      })
      .catch((error: unknown) => {
        setEventsLoadError(getEventsFetchErrorMessage(error));
      });
  };

  const handleEventDeleted = () => {
    void reloadEvents()
      .then(() => {
        setHasRemoteUpdates(false);
        return refreshKnownLastUpdated();
      })
      .catch((error: unknown) => {
        setEventsLoadError(getEventsFetchErrorMessage(error));
      });
  };

  const handleRefreshBlockChange = useCallback((blocked: boolean) => {
    isRefreshBlockedRef.current = blocked;
    setIsRefreshBlocked(blocked);
  }, []);

  const handleManualRefresh = useCallback(async () => {
    if (isRefreshBlockedRef.current || isRefreshing || activeEventFetchCountRef.current > 0) return;
    setIsRefreshing(true);
    setEventsLoadError('');
    setGoogleSyncMessage('');
    setGoogleSyncError('');
    try {
      await reloadEvents();
      const latest = await fetchLastUpdatedAt();
      if (latest !== undefined) setKnownLastUpdated(latest);
      setHasRemoteUpdates(false);
    } catch (error: unknown) {
      setEventsLoadError(getEventsFetchErrorMessage(error));
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchLastUpdatedAt, isRefreshing, reloadEvents, setKnownLastUpdated]);

  const handleHeaderGoogleSync = useCallback(() => {
    if (!canUseGoogleSync(currentRole) || googleSyncDisabled || isGooglePreviewLoading || isGoogleSyncing) return;
    setGoogleSyncMessage('');
    setGoogleSyncError('');
    setGoogleSyncModalError('');
    setShowGoogleSyncMode(true);
  }, [currentRole, googleSyncDisabled, isGooglePreviewLoading, isGoogleSyncing]);

  const handleImportGoogleSyncRequest = useCallback(async () => {
    if (!canUseGoogleSync(currentRole) || googleSyncDisabled || isGooglePreviewLoading || isGoogleSyncing) return;
    setIsGooglePreviewLoading(true);
    setShowGoogleSyncMode(false);
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

  const handleReverseGoogleSyncRequest = useCallback(async () => {
    if (!canUseGoogleSync(currentRole) || googleSyncDisabled || isGooglePreviewLoading || isGoogleSyncing) return;
    setIsGooglePreviewLoading(true);
    setShowGoogleSyncMode(false);
    setGoogleSyncMessage('');
    setGoogleSyncError('');
    setGoogleSyncModalError('');
    try {
      const res = await apiFetch('/api/sync/google/reverse/preview');
      const data = (await res.json().catch(() => null)) as
        | GoogleReverseSyncPreview
        | { reason?: string }
        | null;

      if (!res.ok) {
        const reason = data && 'reason' in data ? data.reason : undefined;
        setGoogleSyncError(reason === 'forbidden' ? '同期権限がありません' : '逆同期プレビューに失敗しました');
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
        setGoogleReverseSyncPreview(data);
        setSelectedReverseCreateIds([]);
        setSelectedReverseUpdatePairKeys([]);
        setSelectedReverseCreateColorIds(
          Object.fromEntries(data.createCandidates.map((item) => [item.sheetEventId, item.suggestedColorId])),
        );
        setSelectedReverseUpdateColorIds(
          Object.fromEntries(data.updateCandidates.map((item) => [googleReversePairKey(item), item.suggestedColorId])),
        );
      } else {
        setGoogleSyncError('逆同期プレビューに失敗しました');
      }
    } catch {
      setGoogleSyncError('逆同期プレビューに失敗しました');
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

  const handleToggleReverseCreate = useCallback((sheetEventId: string) => {
    setSelectedReverseCreateIds((current) =>
      current.includes(sheetEventId)
        ? current.filter((id) => id !== sheetEventId)
        : [...current, sheetEventId],
    );
  }, []);

  const handleToggleReverseUpdate = useCallback((pair: GoogleReverseUpdateCandidate) => {
    const key = googleReversePairKey(pair);
    setSelectedReverseUpdatePairKeys((current) =>
      current.includes(key)
        ? current.filter((id) => id !== key)
        : [...current, key],
    );
  }, []);

  const handleCloseReverseGooglePreview = useCallback(() => {
    if (isGoogleSyncing) return;
    setGoogleReverseSyncPreview(null);
    setSelectedReverseCreateIds([]);
    setSelectedReverseUpdatePairKeys([]);
    setSelectedReverseCreateColorIds({});
    setSelectedReverseUpdateColorIds({});
    setGoogleSyncModalError('');
  }, [isGoogleSyncing]);

  const handleReverseCreateColorChange = useCallback((sheetEventId: string, colorId: string) => {
    setSelectedReverseCreateColorIds((current) => ({ ...current, [sheetEventId]: colorId }));
  }, []);

  const handleReverseUpdateColorChange = useCallback((pairKey: string, colorId: string) => {
    setSelectedReverseUpdateColorIds((current) => ({ ...current, [pairKey]: colorId }));
  }, []);

  const handleConfirmGoogleSync = useCallback(async () => {
    if (selectedGoogleEventIds.length === 0 || isGoogleSyncing) return;

    setIsGoogleSyncing(true);
    setGoogleSyncModalError('');
    setGoogleSyncMessage('');
    setGoogleSyncError('');
    let syncSucceeded = false;
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
        setGoogleSyncPreview(null);
        setSelectedGoogleEventIds([]);
        setExpandedGoogleCategoryIds([]);
        return;
      }

      syncSucceeded = true;
      setGoogleSyncPreview(null);
      setSelectedGoogleEventIds([]);
      setExpandedGoogleCategoryIds([]);
      await reloadEvents();
      setGoogleSyncMessage('Google同期しました');
      setHasRemoteUpdates(false);
      refreshKnownLastUpdated();
    } catch (error: unknown) {
      if (syncSucceeded) {
        setEventsLoadError(getEventsFetchErrorMessage(error));
      } else {
        setGoogleSyncModalError('Google同期に失敗しました');
      }
    } finally {
      setIsGoogleSyncing(false);
    }
  }, [isGoogleSyncing, refreshKnownLastUpdated, reloadEvents, selectedGoogleEventIds]);

  const handleConfirmReverseGoogleSync = useCallback(async () => {
    if (!googleReverseSyncPreview || isGoogleSyncing) return;
    const selectedUpdatePairs = googleReverseSyncPreview.updateCandidates.filter((pair) =>
      selectedReverseUpdatePairKeys.includes(googleReversePairKey(pair)),
    );
    if (selectedReverseCreateIds.length === 0 && selectedUpdatePairs.length === 0) return;

    setIsGoogleSyncing(true);
    setGoogleSyncModalError('');
    setGoogleSyncMessage('');
    setGoogleSyncError('');
    let syncSucceeded = false;
    try {
      const res = await apiFetch('/api/sync/google/reverse', {
        method: 'POST',
        body: JSON.stringify({
          createItems: selectedReverseCreateIds.map((sheetEventId) => ({
            sheetEventId,
            colorId: selectedReverseCreateColorIds[sheetEventId] ?? '11',
          })),
          updateItems: selectedUpdatePairs.map((pair) => ({
            sheetEventId: pair.sheetEventId,
            googleEventId: pair.googleEventId,
            colorId: selectedReverseUpdateColorIds[googleReversePairKey(pair)] ?? '11',
          })),
        }),
      });
      const data = (await res.json().catch(() => null)) as { reason?: string; errors?: string[] } | null;

      if (!res.ok) {
        setGoogleSyncModalError(data?.reason === 'no_events_selected' ? '反映する予定を選択してください' : 'Googleへの反映に失敗しました');
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

      syncSucceeded = true;
      setGoogleReverseSyncPreview(null);
      setSelectedReverseCreateIds([]);
      setSelectedReverseUpdatePairKeys([]);
      setSelectedReverseCreateColorIds({});
      setSelectedReverseUpdateColorIds({});
      await reloadEvents();
      if (data?.errors && data.errors.length > 0) {
        setGoogleSyncMessage(`Googleへ反映しました（一部失敗 ${data.errors.length}件）`);
      } else {
        setGoogleSyncMessage('Googleへ反映しました');
      }
      setHasRemoteUpdates(false);
      refreshKnownLastUpdated();
    } catch (error: unknown) {
      if (syncSucceeded) {
        setEventsLoadError(getEventsFetchErrorMessage(error));
      } else {
        setGoogleSyncModalError('Googleへの反映に失敗しました');
      }
    } finally {
      setIsGoogleSyncing(false);
    }
  }, [
    googleReverseSyncPreview,
    isGoogleSyncing,
    refreshKnownLastUpdated,
    reloadEvents,
    selectedReverseCreateIds,
    selectedReverseCreateColorIds,
    selectedReverseUpdatePairKeys,
    selectedReverseUpdateColorIds,
  ]);

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
        isTodayMonth={year === getInitialYearMonth().year && month === getInitialYearMonth().month}
        syncing={syncing}
        hasRemoteUpdates={hasRemoteUpdates}
        isRefreshing={isRefreshing}
        refreshDisabled={isRefreshBlocked || isEventsFetching}
        showGoogleSync={canUseGoogleSync(currentRole)}
        isGoogleSyncing={isGooglePreviewLoading || isGoogleSyncing}
        googleSyncDisabled={googleSyncDisabled}
        onTodayPress={handleGoToToday}
        onGoogleSync={handleHeaderGoogleSync}
        onRefresh={handleManualRefresh}
        onSettingsOpen={() => setShowSettings(true)}
        onYearMonthPress={() => setShowYearMonthPicker(true)}
      />
      {eventsLoadError && (
        <div className="border-b border-red-100 bg-red-50 px-4 py-2">
          <p className="text-sm text-red-600">{eventsLoadError}</p>
          <p className="mt-0.5 text-xs text-red-500">更新ボタンで再試行できます。</p>
        </div>
      )}
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
        onPrevMonth={goPrevMonth}
        onNextMonth={goNextMonth}
        onRefresh={handleManualRefresh}
        refreshDisabled={isRefreshBlocked || isRefreshing || isEventsFetching || selectedDate !== null}
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
      {showGoogleSyncMode && (
        <GoogleSyncModeModal
          loading={isGooglePreviewLoading || isGoogleSyncing}
          onClose={() => setShowGoogleSyncMode(false)}
          onImport={handleImportGoogleSyncRequest}
          onReverse={handleReverseGoogleSyncRequest}
        />
      )}
      {googleReverseSyncPreview && (
        <GoogleReverseSyncPreviewModal
          preview={googleReverseSyncPreview}
          selectedCreateIds={selectedReverseCreateIds}
          selectedUpdatePairKeys={selectedReverseUpdatePairKeys}
          selectedCreateColorIds={selectedReverseCreateColorIds}
          selectedUpdateColorIds={selectedReverseUpdateColorIds}
          syncing={isGoogleSyncing}
          error={googleSyncModalError}
          onToggleCreate={handleToggleReverseCreate}
          onToggleUpdate={handleToggleReverseUpdate}
          onCreateColorChange={handleReverseCreateColorChange}
          onUpdateColorChange={handleReverseUpdateColorChange}
          onClose={handleCloseReverseGooglePreview}
          onConfirm={handleConfirmReverseGoogleSync}
        />
      )}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
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
