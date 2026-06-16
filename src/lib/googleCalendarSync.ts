import type { calendar_v3 } from 'googleapis';
import type { Event } from '@/types';
import {
  getRows,
  appendRow,
  updateRow,
  getMonthSheetName,
  ensureMonthSheet,
  getAllMonthSheetNames,
} from '@/lib/sheets';
import { parseEventRow, eventToValues } from '@/lib/eventsDb';
import { getSyncMeta, setSyncMeta } from '@/lib/syncMetaDb';
import { getAuthorizedCalendar, parseGCalEvent } from '@/lib/googleCalendar';

const LAST_SYNCED_KEY = 'mother_google_calendar_last_synced_at';
const IMPORT_COMPLETED_KEY = 'mother_google_import_completed';
const SYNC_LOCK_KEY = 'mother_google_sync_lock';
const LOCK_TTL_MS = 5 * 60 * 1000; // 5分
const CALENDAR_ID = () => process.env.GOOGLE_CALENDAR_ID_MOTHER ?? 'primary';
const SYNC_COLOR_IDS = () => process.env.GOOGLE_SYNC_COLOR_IDS_MOTHER ?? '';

// DISABLE_GOOGLE_SYNC=true で全同期処理を停止できる（重複発生時の緊急停止用）
function isSyncDisabled(): boolean {
  return process.env.DISABLE_GOOGLE_SYNC === 'true';
}

export interface SyncResult {
  synced: boolean;
  added: number;
  updated: number;
  deleted: number;
  syncedAt: string;
  reason?: string;
}

export interface GoogleSyncPreviewResult {
  ok: true;
  timeMin: string;
  timeMax: string;
  totalFetched: number;
  validEvents: number;
  cancelled: number;
  categories: Array<{
    categoryId: string;
    label: string;
    icon: string;
    colorIds: string[];
    count: number;
    events: Array<{
      googleEventId: string;
      title: string;
      start: string;
      end: string;
      startTime: string;
      endTime: string;
      allDay: boolean;
      colorId: string;
    }>;
  }>;
}

export interface GoogleSyncDebugResult {
  debug: true;
  calendarId: string;
  timeMin: string;
  timeMax: string;
  totalFetched: number;
  fetched: number;
  includedByColor: number;
  excludedByColor: number;
  wouldAdd: number;
  wouldUpdate: number;
  wouldDelete: number;
  colorIdCounts: Record<string, number>;
  skippedReasonCounts: Record<string, number>;
  sampleEvents: Array<{
    summary: string;
    start: string;
    colorId: string;
    includedByColor: boolean;
  }>;
  syncedAt: string;
}

// ---- 型エイリアス ----

type ExistingEntry = { event: Event; sheetName: string; dataRowIndex: number };
type GoogleSyncSelection = { eventIds?: string[]; colorIds?: string[] };
type GoogleCategoryDefinition = {
  categoryId: string;
  label: string;
  icon: string;
  colorIds: string[];
};

const GOOGLE_CATEGORY_DEFINITIONS: GoogleCategoryDefinition[] = [
  { categoryId: 'salon', label: 'サロン', icon: '🟦', colorIds: ['default'] },
  { categoryId: 'birthday', label: '誕生日', icon: '🎂', colorIds: ['10', '3'] },
  { categoryId: 'personal', label: '個人の予定', icon: '🟪', colorIds: ['11'] },
  { categoryId: 'kappa', label: 'かっぱ', icon: '🟨', colorIds: ['5'] },
];

const GOOGLE_CATEGORY_BY_COLOR_ID = new Map<string, GoogleCategoryDefinition>(
  GOOGLE_CATEGORY_DEFINITIONS.flatMap((category) =>
    category.colorIds.map((colorId) => [colorId, category] as const),
  ),
);

function getGoogleCategory(colorId: string): GoogleCategoryDefinition {
  return GOOGLE_CATEGORY_BY_COLOR_ID.get(colorId) ?? {
    categoryId: `color-${colorId}`,
    label: getColorLabel(colorId),
    icon: '',
    colorIds: [colorId],
  };
}

function normalizeColorIds(colorIds: string[] | undefined): string[] {
  if (!colorIds) {
    return SYNC_COLOR_IDS()
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
  }
  return colorIds.map((id) => id.trim()).filter(Boolean);
}

function getSyncColorIdSet(colorIds?: string[]): Set<string> | null {
  const ids = normalizeColorIds(colorIds);
  return ids.length > 0 ? new Set(ids) : null;
}

function getRequiredSyncColorIdSet(colorIds: string[]): Set<string> {
  return new Set(colorIds.map((id) => id.trim()).filter(Boolean));
}

function parseColorIdsParam(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === 'string').map((id) => id.trim()).filter(Boolean);
}

function parseEventIdsParam(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === 'string').map((id) => id.trim()).filter(Boolean);
}

export function parseGoogleSyncColorIdsFromBody(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  return parseColorIdsParam((body as { colorIds?: unknown }).colorIds);
}

export function parseGoogleSyncEventIdsFromBody(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  return parseEventIdsParam((body as { eventIds?: unknown }).eventIds);
}

function parseGoogleSyncColorIdsFromQuery(value: string | null): string[] {
  return (value ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

export function parseGoogleSyncColorIds(value: string | null, body?: unknown): string[] {
  const bodyIds = parseGoogleSyncColorIdsFromBody(body);
  if (bodyIds.length > 0) return bodyIds;
  return parseGoogleSyncColorIdsFromQuery(value);
}

export function parseGoogleSyncSelection(colorIdsQuery: string | null, body?: unknown): GoogleSyncSelection {
  const eventIds = parseGoogleSyncEventIdsFromBody(body);
  if (eventIds.length > 0) return { eventIds };
  return { colorIds: parseGoogleSyncColorIds(colorIdsQuery, body) };
}

// Google Calendar API の Event.colorId を同期対象判定に使う。
// カレンダー自体の色ではなく、イベント個別の色。色未設定イベントは default として扱う。
function getEventColorId(item: calendar_v3.Schema$Event): string {
  return item.colorId ?? 'default';
}

function isIncludedByColor(item: calendar_v3.Schema$Event, colorIds: Set<string> | null): boolean {
  if (!colorIds) return true;
  return colorIds.has(getEventColorId(item));
}

function incrementCount(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function getEventStartForDebug(item: calendar_v3.Schema$Event): string {
  return item.start?.dateTime ?? item.start?.date ?? '';
}

function getColorLabel(colorId: string): string {
  return colorId === 'default' ? 'デフォルト' : `色 ${colorId}`;
}

// ---- 簡易同期ロック ----
// sync_meta の mother_google_sync_lock に ISO 日時を保存する。
// 同一キーへの読み書きは Sheets API の性質上アトミックではないが、
// MVP では誤って同時実行する確率を下げる目的で十分とする。

async function acquireSyncLock(): Promise<boolean> {
  const existing = await getSyncMeta(SYNC_LOCK_KEY);
  if (existing) {
    const elapsed = Date.now() - new Date(existing).getTime();
    if (elapsed < LOCK_TTL_MS) return false; // TTL 内 → 他のプロセスが同期中
  }
  await setSyncMeta(SYNC_LOCK_KEY, new Date().toISOString());
  return true;
}

async function releaseSyncLock(): Promise<void> {
  // 空文字で上書きするとロックなし扱いになる（getSyncMeta 戻り値は null または truthy）
  await setSyncMeta(SYNC_LOCK_KEY, '').catch(() => {});
}

// ---- ページネーション ----

async function listGCalItems(
  calendar: calendar_v3.Calendar,
  options: calendar_v3.Params$Resource$Events$List,
): Promise<calendar_v3.Schema$Event[]> {
  const items: calendar_v3.Schema$Event[] = [];
  let pageToken: string | undefined;
  do {
    const res = await calendar.events.list({ ...options, pageToken });
    items.push(...(res.data.items ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return items;
}

// ---- existingMap 構築 ----
// スプレッドシート内の全 YYYY-MM シートを走査して google_event_id → 行情報のマップを返す。
// 同一 google_event_id が複数行ある場合: 非削除 > 削除、updated_at が新しい方を優先。

async function buildGoogleEventIdMap(): Promise<Map<string, ExistingEntry>> {
  const map = new Map<string, ExistingEntry>();
  const monthSheetNames = await getAllMonthSheetNames();

  for (const sheetName of monthSheetNames) {
    const rows = await getRows(sheetName);
    rows.forEach((row, idx) => {
      if (!row.google_event_id) return;
      const event = parseEventRow(row);
      const existing = map.get(row.google_event_id);
      if (!existing) {
        map.set(row.google_event_id, { event, sheetName, dataRowIndex: idx });
      } else {
        const prevDeleted = existing.event.deleted;
        const curDeleted = event.deleted;
        if (prevDeleted && !curDeleted) {
          map.set(row.google_event_id, { event, sheetName, dataRowIndex: idx });
        } else if (prevDeleted === curDeleted && event.updated_at > existing.event.updated_at) {
          map.set(row.google_event_id, { event, sheetName, dataRowIndex: idx });
        }
      }
    });
  }

  return map;
}

// ---- append 直前再チェック ----
// 対象シートを再読して google_event_id の存在を確認する。
// 並行リクエストが先に append した場合をここで検知できる。
// rowCount は append 後の existingMap 更新で dataRowIndex として使う
// （append 前の行数 = 新規行の 0-based インデックス）。

async function recheckSheet(
  sheetName: string,
  googleEventId: string,
): Promise<{ existing: ExistingEntry | null; rowCount: number }> {
  const rows = await getRows(sheetName);
  const idx = rows.findIndex(
    (r) => r.google_event_id === googleEventId && r.deleted !== 'TRUE',
  );
  return {
    existing: idx === -1
      ? null
      : { event: parseEventRow(rows[idx]), sheetName, dataRowIndex: idx },
    rowCount: rows.length,
  };
}

async function ensureMonthSheetByName(sheetName: string): Promise<void> {
  const [yearStr, monthStr] = sheetName.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isNaN(year) && !Number.isNaN(month)) {
    await ensureMonthSheet(year, month);
  }
}

// ---- 日付ヘルパー ----

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function currentJstToYearEndRange(): { timeMin: string; timeMax: string } {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const year = jst.getUTCFullYear();
  const month = pad2(jst.getUTCMonth() + 1);
  const day = pad2(jst.getUTCDate());
  const hours = pad2(jst.getUTCHours());
  const minutes = pad2(jst.getUTCMinutes());
  const seconds = pad2(jst.getUTCSeconds());
  return {
    timeMin: `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+09:00`,
    timeMax: `${year + 1}-01-01T00:00:00+09:00`,
  };
}


// ---- 初回取り込み ----
// OAuth認証完了直後に一度だけ実行する。
// mother_google_import_completed = TRUE の場合はスキップ。
// DISABLE_GOOGLE_SYNC=true の場合は何もしない。
// 取得範囲: Asia/Tokyo基準の当年のみ（繰り返し予定の将来年大量登録を防ぐ）

export async function importGoogleCalendar(): Promise<SyncResult> {
  if (isSyncDisabled()) {
    return { synced: false, added: 0, updated: 0, deleted: 0, syncedAt: '', reason: 'sync_disabled' };
  }

  const importCompleted = await getSyncMeta(IMPORT_COMPLETED_KEY);
  if (importCompleted === 'TRUE') {
    return { synced: false, added: 0, updated: 0, deleted: 0, syncedAt: '', reason: 'already_imported' };
  }

  // ロック取得: already_imported チェック後に行い、同時実行を防ぐ
  const locked = await acquireSyncLock();
  if (!locked) {
    return { synced: false, added: 0, updated: 0, deleted: 0, syncedAt: '', reason: 'locked' };
  }

  try {
    const calendar = await getAuthorizedCalendar();
    if (!calendar) {
      return { synced: false, added: 0, updated: 0, deleted: 0, syncedAt: '', reason: 'not_connected' };
    }

    const { timeMin, timeMax } = currentJstToYearEndRange();
    const items = await listGCalItems(calendar, {
      calendarId: CALENDAR_ID(),
      timeMin,
      timeMax,
      singleEvents: true,
      maxResults: 2500,
      showDeleted: false,
    });

    const existingMap = await buildGoogleEventIdMap();
    const syncedAt = new Date().toISOString();
    // processedIds: 同一同期内で同じ item.id を二重処理しない
    const processedIds = new Set<string>();
    const syncColorIds = getSyncColorIdSet();
    let added = 0;

    for (const item of items) {
      if (!item.id) continue;
      if (processedIds.has(item.id)) continue;
      processedIds.add(item.id);
      if (!isIncludedByColor(item, syncColorIds)) continue;

      if (existingMap.has(item.id)) continue; // 同期開始時点で既存 → スキップ

      const parsed = parseGCalEvent(item);
      if (!parsed) continue;

      const [yearStr, monthStr] = parsed.start_date.split('-');
      const evYear = parseInt(yearStr);
      const evMonth = parseInt(monthStr);
      const targetSheet = getMonthSheetName(evYear, evMonth);
      await ensureMonthSheet(evYear, evMonth);

      // append直前再チェック: 並行リクエストが先に書いた場合をここで検知する
      const { existing: recheckExisting, rowCount } = await recheckSheet(targetSheet, item.id);
      if (recheckExisting) {
        existingMap.set(item.id, recheckExisting); // マップを最新状態に更新
        continue;
      }

      const event: Event = {
        id: crypto.randomUUID(),
        owner: 'mother',
        person: 'mother',
        title: parsed.title,
        start_date: parsed.start_date,
        end_date: parsed.end_date,
        start_time: parsed.start_time,
        end_time: parsed.end_time,
        location: parsed.location,
        memo: parsed.memo,
        all_day: parsed.all_day,
        source: 'google',
        google_event_id: parsed.google_event_id,
        google_color_id: getEventColorId(item),
        created_at: syncedAt,
        updated_at: syncedAt,
        deleted: false,
      };

      await appendRow(targetSheet, eventToValues(event));
      // append後 existingMap を即時更新 → 同一同期内で再 append しない
      existingMap.set(item.id, { event, sheetName: targetSheet, dataRowIndex: rowCount });
      added++;
    }

    await setSyncMeta(IMPORT_COMPLETED_KEY, 'TRUE');
    await setSyncMeta(LAST_SYNCED_KEY, syncedAt);

    return { synced: true, added, updated: 0, deleted: 0, syncedAt };
  } finally {
    await releaseSyncLock();
  }
}

// ---- 通常同期 Google → アプリ ----
// POST /api/sync/google から呼ばれる。
// 取得範囲: Asia/Tokyo基準の当年のみ（繰り返し予定の将来年大量登録を防ぐ）
// DISABLE_GOOGLE_SYNC=true の場合は何もしない。
// Google同期由来の追加・更新・削除は即時Push通知と notification_logs の対象外。
// 差分があった場合のみ events_last_updated_at を更新し、他端末の更新バッジに反映する。

export async function syncGoogleToApp(selection: GoogleSyncSelection): Promise<SyncResult> {
  if (isSyncDisabled()) {
    return { synced: false, added: 0, updated: 0, deleted: 0, syncedAt: '', reason: 'sync_disabled' };
  }
  const syncEventIds = selection.eventIds ? new Set(selection.eventIds.map((id) => id.trim()).filter(Boolean)) : null;
  const syncColorIds = syncEventIds ? null : getRequiredSyncColorIdSet(selection.colorIds ?? []);
  if (syncEventIds?.size === 0 || (!syncEventIds && syncColorIds?.size === 0)) {
    return { synced: false, added: 0, updated: 0, deleted: 0, syncedAt: '', reason: 'no_events_selected' };
  }

  // ロック取得: 並行リクエストによる重複 append を防ぐ
  const locked = await acquireSyncLock();
  if (!locked) {
    return { synced: false, added: 0, updated: 0, deleted: 0, syncedAt: '', reason: 'locked' };
  }

  try {
    const calendar = await getAuthorizedCalendar();
    if (!calendar) {
      return { synced: false, added: 0, updated: 0, deleted: 0, syncedAt: '', reason: 'not_connected' };
    }

    const { timeMin, timeMax } = currentJstToYearEndRange();
    // 削除済み含めて取得することで Google 側の削除を検知できる
    const items = await listGCalItems(calendar, {
      calendarId: CALENDAR_ID(),
      timeMin,
      timeMax,
      singleEvents: true,
      maxResults: 2500,
      showDeleted: true,
    });

    const existingMap = await buildGoogleEventIdMap();
    const syncedAt = new Date().toISOString();
    // processedIds: 同一同期内で同じ item.id を二重処理しない
    const processedIds = new Set<string>();
    let added = 0;
    let updated = 0;
    let deleted = 0;

    for (const item of items) {
      if (!item.id) continue;
      if (processedIds.has(item.id)) continue;
      processedIds.add(item.id);
      if (syncEventIds && !syncEventIds.has(item.id)) continue;

      const existing = existingMap.get(item.id);

      if (item.status === 'cancelled') {
        const cancelledColorId = item.colorId ?? existing?.event.google_color_id ?? '';
        if (!syncEventIds && (!cancelledColorId || !syncColorIds?.has(cancelledColorId))) continue;
        // Google 側で削除 → アプリ側も論理削除
        if (existing && !existing.event.deleted) {
          const deletedEvent: Event = { ...existing.event, deleted: true, updated_at: syncedAt };
          await ensureMonthSheetByName(existing.sheetName);
          await updateRow(existing.sheetName, existing.dataRowIndex, eventToValues(deletedEvent));
          existingMap.set(item.id, { ...existing, event: deletedEvent }); // マップ更新
          deleted++;
        }
        continue;
      }

      if (!syncEventIds && !isIncludedByColor(item, syncColorIds)) continue;
      const parsed = parseGCalEvent(item);
      if (!parsed) continue;
      const googleColorId = getEventColorId(item);

      if (!existing) {
        // 新規: 全月シートに存在しない場合のみ append
        const [yearStr, monthStr] = parsed.start_date.split('-');
        const evYear = parseInt(yearStr);
        const evMonth = parseInt(monthStr);
        const targetSheet = getMonthSheetName(evYear, evMonth);
        await ensureMonthSheet(evYear, evMonth);

        // append直前再チェック: 並行リクエストが先に書いた場合をここで検知する
        const { existing: recheckExisting, rowCount } = await recheckSheet(targetSheet, item.id);
        if (recheckExisting) {
          existingMap.set(item.id, recheckExisting); // マップを最新状態に更新
          continue;
        }

        const newEvent: Event = {
          id: crypto.randomUUID(),
          owner: 'mother',
          person: 'mother',
          title: parsed.title,
          start_date: parsed.start_date,
          end_date: parsed.end_date,
          start_time: parsed.start_time,
          end_time: parsed.end_time,
          location: parsed.location,
          memo: parsed.memo,
          all_day: parsed.all_day,
          source: 'google',
          google_event_id: parsed.google_event_id,
          google_color_id: googleColorId,
          created_at: syncedAt,
          updated_at: syncedAt,
          deleted: false,
        };

        await appendRow(targetSheet, eventToValues(newEvent));
        // append後 existingMap を即時更新 → 同一同期内で再 append しない
        existingMap.set(item.id, { event: newEvent, sheetName: targetSheet, dataRowIndex: rowCount });
        added++;
      } else if (!existing.event.deleted) {
        // 変更チェック
        const e = existing.event;
        const changed =
          e.title !== parsed.title ||
          e.start_date !== parsed.start_date ||
          e.end_date !== parsed.end_date ||
          e.start_time !== parsed.start_time ||
          e.end_time !== parsed.end_time ||
          e.all_day !== parsed.all_day ||
          e.location !== parsed.location ||
          e.memo !== parsed.memo ||
          e.google_color_id !== googleColorId;

        if (changed) {
          const updatedEvent: Event = {
            ...e,
            title: parsed.title,
            start_date: parsed.start_date,
            end_date: parsed.end_date,
            start_time: parsed.start_time,
            end_time: parsed.end_time,
            all_day: parsed.all_day,
            location: parsed.location,
            memo: parsed.memo,
            google_color_id: googleColorId,
            updated_at: syncedAt,
          };
          await ensureMonthSheetByName(existing.sheetName);
          await updateRow(existing.sheetName, existing.dataRowIndex, eventToValues(updatedEvent));
          existingMap.set(item.id, { ...existing, event: updatedEvent }); // マップ更新
          updated++;
        }
      }
    }

    if (added + updated + deleted > 0) {
      await setSyncMeta('events_last_updated_at', new Date().toISOString());
    }
    await setSyncMeta(LAST_SYNCED_KEY, syncedAt);
    return { synced: true, added, updated, deleted, syncedAt };
  } finally {
    await releaseSyncLock();
  }
}

// ---- Google同期プレビュー ----
// 現在日時から当年末までのGoogle予定を取得し、Event.colorIdごとに件数を返す。

export async function previewGoogleSync(): Promise<GoogleSyncPreviewResult | SyncResult> {
  if (isSyncDisabled()) {
    return { synced: false, added: 0, updated: 0, deleted: 0, syncedAt: '', reason: 'sync_disabled' };
  }

  const calendar = await getAuthorizedCalendar();
  if (!calendar) {
    return { synced: false, added: 0, updated: 0, deleted: 0, syncedAt: '', reason: 'not_connected' };
  }

  const { timeMin, timeMax } = currentJstToYearEndRange();
  const items = await listGCalItems(calendar, {
    calendarId: CALENDAR_ID(),
    timeMin,
    timeMax,
    singleEvents: true,
    maxResults: 2500,
    showDeleted: true,
  });

  type CategoryGroup = GoogleSyncPreviewResult['categories'][number];
  const groups = new Map<string, CategoryGroup>();
  let validEvents = 0;
  let cancelled = 0;

  for (const item of items) {
    if (item.status === 'cancelled') {
      cancelled++;
      continue;
    }
    const parsed = parseGCalEvent(item);
    if (!parsed || !item.id) continue;

    validEvents++;
    const colorId = getEventColorId(item);
    const category = getGoogleCategory(colorId);
    const group = groups.get(category.categoryId) ?? {
      categoryId: category.categoryId,
      label: category.label,
      icon: category.icon,
      colorIds: category.colorIds,
      count: 0,
      events: [],
    };
    group.count++;
    group.events.push({
      googleEventId: item.id,
      title: parsed.title,
      start: parsed.start_date,
      end: parsed.end_date,
      startTime: parsed.start_time,
      endTime: parsed.end_time,
      allDay: parsed.all_day,
      colorId,
    });
    groups.set(category.categoryId, group);
  }

  return {
    ok: true,
    timeMin,
    timeMax,
    totalFetched: items.length,
    validEvents,
    cancelled,
    categories: [...groups.values()].sort((a, b) => {
      const aIndex = GOOGLE_CATEGORY_DEFINITIONS.findIndex((category) => category.categoryId === a.categoryId);
      const bIndex = GOOGLE_CATEGORY_DEFINITIONS.findIndex((category) => category.categoryId === b.categoryId);
      if (aIndex !== -1 || bIndex !== -1) {
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      }
      return a.label.localeCompare(b.label, 'ja');
    }),
  };
}

// ---- Google同期デバッグ ----
// POST /api/sync/google?debug=true から呼ばれる読み取り専用のドライラン。
// Sheets への追加・更新・削除、sync_meta 更新、ロック取得は行わない。

export async function debugGoogleSync(): Promise<GoogleSyncDebugResult | SyncResult> {
  if (isSyncDisabled()) {
    return { synced: false, added: 0, updated: 0, deleted: 0, syncedAt: '', reason: 'sync_disabled' };
  }

  const calendar = await getAuthorizedCalendar();
  if (!calendar) {
    return { synced: false, added: 0, updated: 0, deleted: 0, syncedAt: '', reason: 'not_connected' };
  }

  const { timeMin, timeMax } = currentJstToYearEndRange();
  const items = await listGCalItems(calendar, {
    calendarId: CALENDAR_ID(),
    timeMin,
    timeMax,
    singleEvents: true,
    maxResults: 2500,
    showDeleted: true,
  });

  const existingMap = await buildGoogleEventIdMap();
  const syncColorIds = getSyncColorIdSet();
  const colorIdCounts: Record<string, number> = {};
  const skippedReasonCounts: Record<string, number> = {};
  const sampleEvents: GoogleSyncDebugResult['sampleEvents'] = [];
  const processedIds = new Set<string>();
  let includedByColor = 0;
  let excludedByColor = 0;
  let wouldAdd = 0;
  let wouldUpdate = 0;
  let wouldDelete = 0;

  for (const item of items) {
    const colorId = getEventColorId(item);
    const included = isIncludedByColor(item, syncColorIds);
    incrementCount(colorIdCounts, colorId);

    if (sampleEvents.length < 20) {
      sampleEvents.push({
        summary: item.summary ?? '(タイトルなし)',
        start: getEventStartForDebug(item),
        colorId,
        includedByColor: included,
      });
    }

    if (!item.id) {
      incrementCount(skippedReasonCounts, 'missing_id');
      continue;
    }
    if (processedIds.has(item.id)) {
      incrementCount(skippedReasonCounts, 'duplicate_in_response');
      continue;
    }
    processedIds.add(item.id);

    if (!included) {
      excludedByColor++;
      incrementCount(skippedReasonCounts, 'excluded_by_color');
      continue;
    }
    includedByColor++;

    const existing = existingMap.get(item.id);
    if (item.status === 'cancelled') {
      if (existing && !existing.event.deleted) {
        wouldDelete++;
      } else {
        incrementCount(skippedReasonCounts, 'cancelled_no_existing');
      }
      continue;
    }

    const parsed = parseGCalEvent(item);
    if (!parsed) {
      incrementCount(skippedReasonCounts, 'parse_failed');
      continue;
    }

    if (!existing) {
      wouldAdd++;
      continue;
    }
    if (existing.event.deleted) {
      incrementCount(skippedReasonCounts, 'existing_deleted_in_app');
      continue;
    }

    const e = existing.event;
    const changed =
      e.title !== parsed.title ||
      e.start_date !== parsed.start_date ||
      e.end_date !== parsed.end_date ||
      e.start_time !== parsed.start_time ||
      e.end_time !== parsed.end_time ||
      e.all_day !== parsed.all_day ||
      e.location !== parsed.location ||
      e.memo !== parsed.memo;

    if (changed) {
      wouldUpdate++;
    } else {
      incrementCount(skippedReasonCounts, 'already_synced_no_change');
    }
  }

  return {
    debug: true,
    calendarId: CALENDAR_ID(),
    timeMin,
    timeMax,
    totalFetched: items.length,
    fetched: items.length,
    includedByColor,
    excludedByColor,
    wouldAdd,
    wouldUpdate,
    wouldDelete,
    colorIdCounts,
    skippedReasonCounts,
    sampleEvents,
    syncedAt: new Date().toISOString(),
  };
}

// ---- 重複クリーンアップ ----
// source=google かつ google_event_id が空でない行を全月シートから収集し、
// 同一 google_event_id が複数行ある場合に updated_at 最新の1件を残して他を論理削除する。
// 未来年シートも対象（getAllMonthSheetNames が全 YYYY-MM シートを返す）。

export interface CleanupResult {
  scannedSheets: number;
  duplicateIds: number;
  cleaned: number;
}

export async function cleanupGoogleDuplicates(): Promise<CleanupResult> {
  const monthSheetNames = await getAllMonthSheetNames();

  type RowEntry = { sheetName: string; dataRowIndex: number; updatedAt: string };
  const byGoogleId = new Map<string, RowEntry[]>();
  const sheetRowsCache = new Map<string, Record<string, string>[]>();

  for (const sheetName of monthSheetNames) {
    const rows = await getRows(sheetName);
    sheetRowsCache.set(sheetName, rows);

    rows.forEach((row, idx) => {
      if (!row.google_event_id || row.deleted === 'TRUE') return;
      const entry: RowEntry = {
        sheetName,
        dataRowIndex: idx,
        updatedAt: row.updated_at ?? '',
      };
      const existing = byGoogleId.get(row.google_event_id);
      if (!existing) {
        byGoogleId.set(row.google_event_id, [entry]);
      } else {
        existing.push(entry);
      }
    });
  }

  const now = new Date().toISOString();
  let duplicateIds = 0;
  let cleaned = 0;

  for (const [, entries] of byGoogleId) {
    if (entries.length <= 1) continue;
    duplicateIds++;

    // updated_at 降順にソートして最新の1件を残す
    entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    for (let i = 1; i < entries.length; i++) {
      const entry = entries[i];
      const rows = sheetRowsCache.get(entry.sheetName);
      if (!rows) continue;
      const row = rows[entry.dataRowIndex];
      if (!row) continue;
      const event = parseEventRow(row);
      const deletedEvent: Event = { ...event, deleted: true, updated_at: now };
      await ensureMonthSheetByName(entry.sheetName);
      await updateRow(entry.sheetName, entry.dataRowIndex, eventToValues(deletedEvent));
      cleaned++;
    }
  }

  return { scannedSheets: monthSheetNames.length, duplicateIds, cleaned };
}
