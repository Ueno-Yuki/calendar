import type { calendar_v3 } from 'googleapis';
import type { Event } from '@/types';
import {
  getRows,
  appendRowByHeaders,
  updateRowByHeaders,
  getMonthSheetName,
  ensureMonthSheet,
  getAllMonthSheetNames,
} from '@/lib/sheets';
import { parseEventRow, eventToRecord } from '@/lib/eventsDb';
import { getAllSyncMeta, getSyncMeta, setSyncMeta } from '@/lib/syncMetaDb';
import {
  createGCalEvent,
  getAuthorizedCalendar,
  getStoredGoogleRefreshToken,
  parseGCalEvent,
  updateGCalEvent,
} from '@/lib/googleCalendar';

const LAST_SYNCED_KEY = 'mother_google_calendar_last_synced_at';
const IMPORT_COMPLETED_KEY = 'mother_google_import_completed';
const SYNC_LOCK_KEY = 'mother_google_sync_lock';
const LOCK_TTL_MS = 5 * 60 * 1000; // 5分
const CALENDAR_ID = () => process.env.GOOGLE_CALENDAR_ID_MOTHER ?? 'primary';

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
  skippedAlreadyImported?: number;
  reason?: string;
}

export interface GoogleSyncPreviewResult {
  ok: true;
  timeMin: string;
  timeMax: string;
  totalFetched: number;
  validEvents: number;
  cancelled: number;
  alreadyImported: number;
  selectable: number;
  categories: Array<{
    categoryId: string;
    label: string;
    icon: string;
    colorIds: string[];
    count: number;
    alreadyImported: number;
    selectableCount: number;
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

export interface GoogleSyncPreviewErrorResult {
  ok: false;
  reason: GoogleSyncFailureReason;
}

export type GoogleSyncFailureReason =
  | 'sync_disabled'
  | 'not_connected'
  | 'google_reauth_required'
  | 'google_auth_failed'
  | 'google_scope_missing'
  | 'sheets_read_failed'
  | 'quota_exceeded'
  | 'unknown';

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

export interface GoogleReverseSyncPreviewResult {
  ok: true;
  timeMin: string;
  timeMax: string;
  createCandidates: Array<{
    sheetEventId: string;
    title: string;
    startDate: string;
    endDate: string;
    startTime: string;
    endTime: string;
    allDay: boolean;
    suggestedColorId: string;
  }>;
  updateCandidates: Array<{
    sheetEventId: string;
    googleEventId: string;
    startDate: string;
    appTitle: string;
    googleTitle: string;
    suggestedColorId: string;
  }>;
  skipped: Array<{
    sheetEventId: string;
    title: string;
    startDate: string;
    reason: string;
  }>;
}

export interface GoogleReverseSyncResult {
  synced: boolean;
  created: number;
  updated: number;
  skipped: number;
  syncedAt: string;
  errors?: string[];
  reason?: string;
}

// ---- 型エイリアス ----

type ExistingEntry = { event: Event; sheetName: string; dataRowIndex: number };
type GoogleSyncSelection = { eventIds?: string[]; colorIds?: string[] };
type SheetEventEntry = { event: Event; sheetName: string; dataRowIndex: number };
type GoogleReverseSelection = {
  createItems: Array<{ sheetEventId: string; colorId: string }>;
  updateItems: Array<{ sheetEventId: string; googleEventId: string; colorId: string }>;
};
type GoogleCategoryDefinition = {
  categoryId: string;
  label: string;
  icon: string;
  colorIds: string[];
};

// Google Calendar の固定 colorId 列挙（Googleの標準色名）。
// Google側のenumなのでメンテナンス不要。未知のcolorIdは通常発生しない。
const GOOGLE_STANDARD_COLOR_LABELS: Record<string, string> = {
  default: 'デフォルト',
  '1': 'ラベンダー',
  '2': 'セージ',
  '3': 'ブドウ',
  '4': 'フラミンゴ',
  '5': 'バナナ',
  '6': 'マンダリン',
  '7': 'ピーコック',
  '8': 'グラファイト',
  '9': 'ブルーベリー',
  '10': 'バジル',
  '11': 'トマト',
};

const GOOGLE_COLOR_ID_ORDER = ['default', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];

const REVERSE_SYNC_COLOR_OPTIONS = [
  { colorId: 'default', label: 'サロン' },
  { colorId: '10', label: '誕生日' },
  { colorId: '11', label: '個人の予定' },
  { colorId: '5', label: 'かっぱ' },
] as const;

const REVERSE_SYNC_ALLOWED_COLOR_IDS: Set<string> = new Set(
  REVERSE_SYNC_COLOR_OPTIONS.map((option) => option.colorId),
);

function getGoogleCategory(colorId: string): GoogleCategoryDefinition {
  return {
    categoryId: `color-${colorId}`,
    label: getColorLabel(colorId),
    icon: '',
    colorIds: [colorId],
  };
}

function normalizeImportTitle(title: string): string {
  return title.trim().replace(/[ \u3000]+/g, ' ');
}

function buildImportKey(startDate: string, title: string): string {
  return `${startDate}::${normalizeImportTitle(title)}`;
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

export function parseGoogleReverseSelection(body: unknown): GoogleReverseSelection {
  if (!body || typeof body !== 'object') return { createItems: [], updateItems: [] };
  const record = body as { createItems?: unknown; updateItems?: unknown };
  const createItems = Array.isArray(record.createItems)
    ? record.createItems
        .filter((item): item is { sheetEventId: string; colorId: string } => {
          if (!item || typeof item !== 'object') return false;
          const p = item as { sheetEventId?: unknown; colorId?: unknown };
          return typeof p.sheetEventId === 'string' && typeof p.colorId === 'string';
        })
        .map((item) => ({
          sheetEventId: item.sheetEventId.trim(),
          colorId: normalizeReverseSyncColorId(item.colorId),
        }))
        .filter((item) => item.sheetEventId && item.colorId)
    : [];
  const updateItems = Array.isArray(record.updateItems)
    ? record.updateItems
        .filter((item): item is { sheetEventId: string; googleEventId: string; colorId: string } => {
          if (!item || typeof item !== 'object') return false;
          const p = item as { sheetEventId?: unknown; googleEventId?: unknown; colorId?: unknown };
          return typeof p.sheetEventId === 'string' && typeof p.googleEventId === 'string' && typeof p.colorId === 'string';
        })
        .map((item) => ({
          sheetEventId: item.sheetEventId.trim(),
          googleEventId: item.googleEventId.trim(),
          colorId: normalizeReverseSyncColorId(item.colorId),
        }))
        .filter((item) => item.sheetEventId && item.googleEventId && item.colorId)
    : [];
  return { createItems, updateItems };
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
  return GOOGLE_STANDARD_COLOR_LABELS[colorId] ?? `色 ${colorId}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

function getErrorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

function getGoogleApiErrorResponse(error: unknown): unknown {
  if (!error || typeof error !== 'object') return undefined;
  const maybeError = error as { response?: { data?: unknown } };
  return maybeError.response?.data;
}

function getApiErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const maybeError = error as { code?: number; response?: { status?: number } };
  return maybeError.response?.status ?? maybeError.code;
}

function getApiErrorBodyMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const maybeError = error as {
    message?: string;
    response?: { data?: { error?: { message?: string } } };
  };
  return maybeError.response?.data?.error?.message ?? maybeError.message ?? '';
}

function isQuotaExceededError(error: unknown): boolean {
  const status = getApiErrorStatus(error);
  const message = getApiErrorBodyMessage(error).toLowerCase();
  return (
    status === 429 ||
    message.includes('quota exceeded') ||
    message.includes('read requests per minute') ||
    message.includes('rate limit exceeded')
  );
}

function isGoogleScopeMissingError(error: unknown): boolean {
  const message = getApiErrorBodyMessage(error).toLowerCase();
  return message.includes('insufficient authentication scopes') || message.includes('insufficientpermissions');
}

function isGoogleAuthFailedError(error: unknown): boolean {
  const status = getApiErrorStatus(error);
  const message = getApiErrorBodyMessage(error).toLowerCase();
  return (
    status === 401 ||
    message.includes('invalid credentials') ||
    message.includes('token has been expired or revoked')
  );
}

function isGoogleReauthRequiredError(error: unknown): boolean {
  const message = getApiErrorBodyMessage(error).toLowerCase();
  return (
    message.includes('invalid_grant') ||
    message.includes('token has been expired or revoked') ||
    message.includes('expired or revoked')
  );
}

type GooglePreviewStep =
  | 'read_sync_meta'
  | 'refresh_google_token'
  | 'fetch_google_events'
  | 'read_existing_events'
  | 'build_preview';

function getGooglePreviewFailureReason(
  step: GooglePreviewStep,
  error: unknown,
): GoogleSyncFailureReason {
  if (isQuotaExceededError(error)) return 'quota_exceeded';
  if (step === 'refresh_google_token') {
    if (isGoogleReauthRequiredError(error)) return 'google_reauth_required';
    if (isGoogleScopeMissingError(error)) return 'google_scope_missing';
    if (isGoogleAuthFailedError(error)) return 'google_auth_failed';
  }
  if (step === 'fetch_google_events') {
    if (isGoogleReauthRequiredError(error)) return 'google_reauth_required';
    if (isGoogleScopeMissingError(error)) return 'google_scope_missing';
    if (isGoogleAuthFailedError(error)) return 'google_auth_failed';
  }
  if (step === 'read_sync_meta' || step === 'read_existing_events') {
    return 'sheets_read_failed';
  }
  return 'unknown';
}

function normalizeReverseSyncColorId(colorId: string | undefined): string {
  const normalized = (colorId ?? '').trim();
  if (normalized === '3') return '10';
  return REVERSE_SYNC_ALLOWED_COLOR_IDS.has(normalized) ? normalized : '11';
}

function inferReverseSyncColorId(event: Event): string {
  const existingColorId = normalizeReverseSyncColorId(event.google_color_id);
  if (event.google_color_id && REVERSE_SYNC_ALLOWED_COLOR_IDS.has(existingColorId)) {
    return existingColorId;
  }
  if (event.title.includes('かっぱ') || event.title.includes('カッパ')) return '5';
  if (event.title.includes('誕生日')) return '10';
  return '11';
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

async function buildExistingImportKeySet(): Promise<Set<string>> {
  const set = new Set<string>();
  const monthSheetNames = await getAllMonthSheetNames();

  for (const sheetName of monthSheetNames) {
    const rows = await getRows(sheetName);
    rows.forEach((row) => {
      if (row.deleted === 'TRUE') return;
      const startDate = row.start_date ?? '';
      const title = row.title ?? '';
      if (!startDate || !title) return;
      set.add(buildImportKey(startDate, title));
    });
  }

  return set;
}

async function buildSheetEventEntryMap(): Promise<Map<string, SheetEventEntry>> {
  const map = new Map<string, SheetEventEntry>();
  const monthSheetNames = await getAllMonthSheetNames();

  for (const sheetName of monthSheetNames) {
    const rows = await getRows(sheetName);
    rows.forEach((row, idx) => {
      const event = parseEventRow(row);
      if (!event.id) return;
      map.set(event.id, { event, sheetName, dataRowIndex: idx });
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

function isMotherEvent(event: Event): boolean {
  return event.owner === 'mother' || event.person === 'mother';
}

function isEventInSyncRange(event: Event, range: { timeMin: string; timeMax: string }): boolean {
  const startDate = event.start_date;
  const rangeStartDate = range.timeMin.slice(0, 10);
  const rangeEndDate = `${range.timeMin.slice(0, 4)}-12-31`;
  if (startDate < rangeStartDate || startDate > rangeEndDate) return false;

  if (startDate > rangeStartDate) return true;

  if (event.all_day || !event.start_time) return true;

  const eventStart = new Date(`${event.start_date}T${event.start_time}:00+09:00`);
  const rangeStart = new Date(range.timeMin);
  if (Number.isNaN(eventStart.getTime()) || Number.isNaN(rangeStart.getTime())) return false;
  return eventStart > rangeStart;
}

function hasGoogleDiff(appEvent: Event, googleEvent: ReturnType<typeof parseGCalEvent>): boolean {
  if (!googleEvent) return false;
  return (
    appEvent.title !== googleEvent.title ||
    appEvent.start_date !== googleEvent.start_date ||
    appEvent.end_date !== googleEvent.end_date ||
    appEvent.start_time !== googleEvent.start_time ||
    appEvent.end_time !== googleEvent.end_time ||
    appEvent.all_day !== googleEvent.all_day ||
    appEvent.location !== googleEvent.location ||
    appEvent.memo !== googleEvent.memo
  );
}

async function listCurrentGoogleEvents(calendar: calendar_v3.Calendar): Promise<{
  range: { timeMin: string; timeMax: string };
  parsedItems: Array<{ item: calendar_v3.Schema$Event; parsed: NonNullable<ReturnType<typeof parseGCalEvent>> }>;
}> {
  const range = currentJstToYearEndRange();
  const items = await listGCalItems(calendar, {
    calendarId: CALENDAR_ID(),
    timeMin: range.timeMin,
    timeMax: range.timeMax,
    singleEvents: true,
    maxResults: 2500,
    showDeleted: false,
  });

  return {
    range,
    parsedItems: items
      .map((item) => ({ item, parsed: parseGCalEvent(item) }))
      .filter((entry): entry is { item: calendar_v3.Schema$Event; parsed: NonNullable<ReturnType<typeof parseGCalEvent>> } =>
        Boolean(entry.item.id && entry.parsed),
      ),
  };
}

function buildGoogleIndexes(
  parsedItems: Array<{ item: calendar_v3.Schema$Event; parsed: NonNullable<ReturnType<typeof parseGCalEvent>> }>,
): {
  byId: Map<string, NonNullable<ReturnType<typeof parseGCalEvent>>>;
  byImportKey: Map<string, NonNullable<ReturnType<typeof parseGCalEvent>>>;
  byStartDate: Map<string, Array<NonNullable<ReturnType<typeof parseGCalEvent>>>>;
} {
  const byId = new Map<string, NonNullable<ReturnType<typeof parseGCalEvent>>>();
  const byImportKey = new Map<string, NonNullable<ReturnType<typeof parseGCalEvent>>>();
  const byStartDate = new Map<string, Array<NonNullable<ReturnType<typeof parseGCalEvent>>>>();

  parsedItems.forEach(({ item, parsed }) => {
    if (item.id) byId.set(item.id, parsed);
    byImportKey.set(buildImportKey(parsed.start_date, parsed.title), parsed);
    const sameDate = byStartDate.get(parsed.start_date) ?? [];
    sameDate.push(parsed);
    byStartDate.set(parsed.start_date, sameDate);
  });

  return { byId, byImportKey, byStartDate };
}

function eventToReversePreviewItem(event: Event) {
  return {
    sheetEventId: event.id,
    title: event.title,
    startDate: event.start_date,
    endDate: event.end_date,
    startTime: event.start_time,
    endTime: event.end_time,
    allDay: event.all_day,
    suggestedColorId: inferReverseSyncColorId(event),
  };
}


// ---- 初回取り込み ----
// OAuth認証完了直後に一度だけ実行する。
// mother_google_import_completed = TRUE の場合はスキップ。
// DISABLE_GOOGLE_SYNC=true の場合は何もしない。
// 取得範囲: Asia/Tokyo基準の現在日時から当年末まで（過去予定と将来年大量登録を防ぐ）

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
    let added = 0;

    for (const item of items) {
      if (!item.id) continue;
      if (processedIds.has(item.id)) continue;
      processedIds.add(item.id);

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

      await appendRowByHeaders(targetSheet, eventToRecord(event));
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
// 取得範囲: Asia/Tokyo基準の現在日時から当年末まで（過去予定と将来年大量登録を防ぐ）
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

  let timeMin = '';
  let timeMax = '';
  let fetchedCount = 0;
  let added = 0;
  let updated = 0;
  let deleted = 0;

  try {
    const calendar = await getAuthorizedCalendar();
    if (!calendar) {
      return { synced: false, added: 0, updated: 0, deleted: 0, syncedAt: '', reason: 'not_connected' };
    }

    ({ timeMin, timeMax } = currentJstToYearEndRange());
    // 削除済み含めて取得することで Google 側の削除を検知できる
    const items = await listGCalItems(calendar, {
      calendarId: CALENDAR_ID(),
      timeMin,
      timeMax,
      singleEvents: true,
      maxResults: 2500,
      showDeleted: true,
    });
    fetchedCount = items.length;

    const existingMap = await buildGoogleEventIdMap();
    const existingImportKeys = await buildExistingImportKeySet();
    const syncedAt = new Date().toISOString();
    // processedIds: 同一同期内で同じ item.id を二重処理しない
    const processedIds = new Set<string>();
    let skippedAlreadyImported = 0;

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
          await updateRowByHeaders(existing.sheetName, existing.dataRowIndex, eventToRecord(deletedEvent));
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
        const importKey = buildImportKey(parsed.start_date, parsed.title);
        if (existingImportKeys.has(importKey)) {
          skippedAlreadyImported++;
          continue;
        }
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

        await appendRowByHeaders(targetSheet, eventToRecord(newEvent));
        // append後 existingMap を即時更新 → 同一同期内で再 append しない
        existingMap.set(item.id, { event: newEvent, sheetName: targetSheet, dataRowIndex: rowCount });
        existingImportKeys.add(importKey);
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
          await updateRowByHeaders(existing.sheetName, existing.dataRowIndex, eventToRecord(updatedEvent));
          existingMap.set(item.id, { ...existing, event: updatedEvent }); // マップ更新
          updated++;
        }
      }
    }

    if (added + updated + deleted > 0) {
      await setSyncMeta('events_last_updated_at', new Date().toISOString());
    }
    await setSyncMeta(LAST_SYNCED_KEY, syncedAt);
    return { synced: true, added, updated, deleted, syncedAt, skippedAlreadyImported };
  } catch (error) {
    console.error('[google-sync] syncGoogleToApp failed', {
      calendarId: CALENDAR_ID(),
      timeMin,
      timeMax,
      selectedColorIds: selection.colorIds ?? [],
      selectedEventIds: selection.eventIds ?? [],
      fetchedCount,
      added,
      updated,
      deleted,
      googleApiResponse: getGoogleApiErrorResponse(error),
      errorMessage: getErrorMessage(error),
      stack: getErrorStack(error),
    });
    throw error;
  } finally {
    await releaseSyncLock();
  }
}

// ---- Google同期プレビュー ----
// 現在日時から当年末までのGoogle予定を取得し、Event.colorIdごとに件数を返す。

export async function previewGoogleSync(): Promise<GoogleSyncPreviewResult | GoogleSyncPreviewErrorResult> {
  if (isSyncDisabled()) {
    return { ok: false, reason: 'sync_disabled' };
  }

  let step: GooglePreviewStep = 'read_sync_meta';

  try {
    const syncMeta = await getAllSyncMeta();
    const refreshToken = getStoredGoogleRefreshToken(syncMeta);
    if (!refreshToken) {
      return { ok: false, reason: 'not_connected' };
    }

    step = 'refresh_google_token';
    const calendar = await getAuthorizedCalendar({ refreshToken, syncMeta });
    if (!calendar) {
      return { ok: false, reason: 'not_connected' };
    }

    step = 'fetch_google_events';
    const { timeMin, timeMax } = currentJstToYearEndRange();
    const items = await listGCalItems(calendar, {
      calendarId: CALENDAR_ID(),
      timeMin,
      timeMax,
      singleEvents: true,
      maxResults: 2500,
      showDeleted: true,
    });

    step = 'read_existing_events';
    const existingImportKeys = await buildExistingImportKeySet();

    step = 'build_preview';
    type CategoryGroup = GoogleSyncPreviewResult['categories'][number];
    const groups = new Map<string, CategoryGroup>();
    let validEvents = 0;
    let cancelled = 0;
    let alreadyImported = 0;

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
        alreadyImported: 0,
        selectableCount: 0,
        events: [],
      };
      group.count++;
      const importKey = buildImportKey(parsed.start_date, parsed.title);
      if (existingImportKeys.has(importKey)) {
        alreadyImported++;
        group.alreadyImported++;
        groups.set(category.categoryId, group);
        continue;
      }
      group.selectableCount++;
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
      alreadyImported,
      selectable: validEvents - alreadyImported,
      categories: [...groups.values()].sort((a, b) => {
        const aIndex = GOOGLE_COLOR_ID_ORDER.indexOf(a.colorIds[0]);
        const bIndex = GOOGLE_COLOR_ID_ORDER.indexOf(b.colorIds[0]);
        if (aIndex !== -1 || bIndex !== -1) {
          if (aIndex === -1) return 1;
          if (bIndex === -1) return -1;
          return aIndex - bIndex;
        }
        return a.label.localeCompare(b.label, 'ja');
      }),
    };
  } catch (error) {
    console.error('[google-preview] failed', {
      step,
      errorMessage: getErrorMessage(error),
      stack: getErrorStack(error),
    });
    return { ok: false, reason: getGooglePreviewFailureReason(step, error) };
  }
}

// ---- 逆同期プレビュー アプリ → Google ----
// 母の予定だけを対象に、現在日時から当年末までのGoogle予定と突き合わせる。
// 削除は扱わず、新規登録候補・更新候補・重複スキップを返す。

export async function previewGoogleReverseSync(): Promise<
  GoogleReverseSyncPreviewResult | GoogleReverseSyncResult | GoogleSyncPreviewErrorResult
> {
  if (isSyncDisabled()) {
    return { synced: false, created: 0, updated: 0, skipped: 0, syncedAt: '', reason: 'sync_disabled' };
  }

  let step: GooglePreviewStep = 'refresh_google_token';

  try {
    const calendar = await getAuthorizedCalendar();
    if (!calendar) {
      return { synced: false, created: 0, updated: 0, skipped: 0, syncedAt: '', reason: 'not_connected' };
    }

    step = 'fetch_google_events';
    const { range, parsedItems } = await listCurrentGoogleEvents(calendar);
    const googleIndexes = buildGoogleIndexes(parsedItems);

    step = 'read_existing_events';
    const sheetEntries = await buildSheetEventEntryMap();

    step = 'build_preview';
    const createCandidates: GoogleReverseSyncPreviewResult['createCandidates'] = [];
    const updateCandidates: GoogleReverseSyncPreviewResult['updateCandidates'] = [];
    const skipped: GoogleReverseSyncPreviewResult['skipped'] = [];

    for (const { event } of sheetEntries.values()) {
      if (event.deleted) continue;
      if (!isMotherEvent(event)) {
        skipped.push({
          sheetEventId: event.id,
          title: event.title,
          startDate: event.start_date,
          reason: 'not_target_user',
        });
        continue;
      }
      if (!isEventInSyncRange(event, range)) {
        skipped.push({
          sheetEventId: event.id,
          title: event.title,
          startDate: event.start_date,
          reason: 'out_of_range',
        });
        continue;
      }

      const importKey = buildImportKey(event.start_date, event.title);
      if (event.google_event_id) {
        const linkedGoogleEvent = googleIndexes.byId.get(event.google_event_id);
        if (!linkedGoogleEvent) {
          skipped.push({
            sheetEventId: event.id,
            title: event.title,
            startDate: event.start_date,
            reason: 'linked_google_event_not_found',
          });
          continue;
        }

        if (hasGoogleDiff(event, linkedGoogleEvent)) {
          updateCandidates.push({
            sheetEventId: event.id,
            googleEventId: event.google_event_id,
            startDate: event.start_date,
            appTitle: event.title,
            googleTitle: linkedGoogleEvent.title,
            suggestedColorId: inferReverseSyncColorId(event),
          });
        } else {
          skipped.push({
            sheetEventId: event.id,
            title: event.title,
            startDate: event.start_date,
            reason: 'only_google_color_diff_or_unchanged',
          });
        }
        continue;
      }

      if (googleIndexes.byImportKey.has(importKey)) {
        skipped.push({
          sheetEventId: event.id,
          title: event.title,
          startDate: event.start_date,
          reason: 'same_date_title_exists',
        });
        continue;
      }

      const sameDateGoogleEvents = googleIndexes.byStartDate.get(event.start_date) ?? [];
      const differentTitleEvents = sameDateGoogleEvents.filter(
        (googleEvent) => normalizeImportTitle(googleEvent.title) !== normalizeImportTitle(event.title),
      );
      if (differentTitleEvents.length === 1) {
        updateCandidates.push({
          sheetEventId: event.id,
          googleEventId: differentTitleEvents[0].google_event_id,
          startDate: event.start_date,
          appTitle: event.title,
          googleTitle: differentTitleEvents[0].title,
          suggestedColorId: inferReverseSyncColorId(event),
        });
        continue;
      }

      createCandidates.push(eventToReversePreviewItem(event));
    }

    return {
      ok: true,
      timeMin: range.timeMin,
      timeMax: range.timeMax,
      createCandidates,
      updateCandidates,
      skipped,
    };
  } catch (error) {
    console.error('[google-reverse-preview] failed', {
      step,
      errorMessage: getErrorMessage(error),
      stack: getErrorStack(error),
    });
    return { ok: false, reason: getGooglePreviewFailureReason(step, error) };
  }
}

// ---- 逆同期実行 アプリ → Google ----
// ユーザーが選択した予定だけをGoogleへ作成・更新する。Push通知は送らない。

export async function syncAppToGoogle(selection: GoogleReverseSelection): Promise<GoogleReverseSyncResult> {
  if (isSyncDisabled()) {
    return { synced: false, created: 0, updated: 0, skipped: 0, syncedAt: '', reason: 'sync_disabled' };
  }
  const createItems = selection.createItems;
  const updateItems = selection.updateItems;
  if (createItems.length === 0 && updateItems.length === 0) {
    return { synced: false, created: 0, updated: 0, skipped: 0, syncedAt: '', reason: 'no_events_selected' };
  }

  const locked = await acquireSyncLock();
  if (!locked) {
    return { synced: false, created: 0, updated: 0, skipped: 0, syncedAt: '', reason: 'locked' };
  }

  try {
    const calendar = await getAuthorizedCalendar();
    if (!calendar) {
      return { synced: false, created: 0, updated: 0, skipped: 0, syncedAt: '', reason: 'not_connected' };
    }

    const { range, parsedItems } = await listCurrentGoogleEvents(calendar);
    const googleIndexes = buildGoogleIndexes(parsedItems);
    const sheetEntries = await buildSheetEventEntryMap();
    const syncedAt = new Date().toISOString();
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let sheetsChanged = 0;
    const errors: string[] = [];

    for (const item of createItems) {
      const entry = sheetEntries.get(item.sheetEventId);
      if (!entry || entry.event.deleted || !isMotherEvent(entry.event) || !isEventInSyncRange(entry.event, range)) {
        skipped++;
        continue;
      }
      if (entry.event.google_event_id || googleIndexes.byImportKey.has(buildImportKey(entry.event.start_date, entry.event.title))) {
        skipped++;
        continue;
      }

      const colorId = normalizeReverseSyncColorId(item.colorId);
      let googleEventId: string | null = null;
      try {
        googleEventId = await createGCalEvent(entry.event, colorId);
      } catch {
        skipped++;
        errors.push(`${entry.event.start_date} ${entry.event.title}: create_failed`);
        continue;
      }
      if (!googleEventId) {
        skipped++;
        errors.push(`${entry.event.start_date} ${entry.event.title}: create_failed`);
        continue;
      }

      const updatedEvent: Event = {
        ...entry.event,
        google_event_id: googleEventId,
        google_color_id: colorId,
        updated_at: syncedAt,
      };
      await updateRowByHeaders(entry.sheetName, entry.dataRowIndex, eventToRecord(updatedEvent));
      googleIndexes.byId.set(googleEventId, {
        google_event_id: googleEventId,
        title: updatedEvent.title,
        start_date: updatedEvent.start_date,
        end_date: updatedEvent.end_date,
        start_time: updatedEvent.start_time,
        end_time: updatedEvent.end_time,
        all_day: updatedEvent.all_day,
        location: updatedEvent.location,
        memo: updatedEvent.memo,
      });
      googleIndexes.byImportKey.set(buildImportKey(updatedEvent.start_date, updatedEvent.title), {
        google_event_id: googleEventId,
        title: updatedEvent.title,
        start_date: updatedEvent.start_date,
        end_date: updatedEvent.end_date,
        start_time: updatedEvent.start_time,
        end_time: updatedEvent.end_time,
        all_day: updatedEvent.all_day,
        location: updatedEvent.location,
        memo: updatedEvent.memo,
      });
      created++;
      sheetsChanged++;
    }

    for (const item of updateItems) {
      const entry = sheetEntries.get(item.sheetEventId);
      const googleEvent = googleIndexes.byId.get(item.googleEventId);
      if (!entry || !googleEvent || entry.event.deleted || !isMotherEvent(entry.event) || !isEventInSyncRange(entry.event, range)) {
        skipped++;
        continue;
      }

      if (!hasGoogleDiff(entry.event, googleEvent)) {
        skipped++;
        continue;
      }

      const colorId = normalizeReverseSyncColorId(item.colorId);
      try {
        await updateGCalEvent(item.googleEventId, entry.event, colorId);
      } catch {
        skipped++;
        errors.push(`${entry.event.start_date} ${entry.event.title}: update_failed`);
        continue;
      }

      const updatedEvent: Event = {
        ...entry.event,
        google_event_id: item.googleEventId,
        google_color_id: colorId,
        updated_at: syncedAt,
      };
      await updateRowByHeaders(entry.sheetName, entry.dataRowIndex, eventToRecord(updatedEvent));
      googleIndexes.byId.set(item.googleEventId, {
        google_event_id: item.googleEventId,
        title: updatedEvent.title,
        start_date: updatedEvent.start_date,
        end_date: updatedEvent.end_date,
        start_time: updatedEvent.start_time,
        end_time: updatedEvent.end_time,
        all_day: updatedEvent.all_day,
        location: updatedEvent.location,
        memo: updatedEvent.memo,
      });
      googleIndexes.byImportKey.set(buildImportKey(updatedEvent.start_date, updatedEvent.title), {
        google_event_id: item.googleEventId,
        title: updatedEvent.title,
        start_date: updatedEvent.start_date,
        end_date: updatedEvent.end_date,
        start_time: updatedEvent.start_time,
        end_time: updatedEvent.end_time,
        all_day: updatedEvent.all_day,
        location: updatedEvent.location,
        memo: updatedEvent.memo,
      });
      sheetsChanged++;
      updated++;
    }

    if (sheetsChanged > 0) {
      await setSyncMeta('events_last_updated_at', new Date().toISOString());
    }
    await setSyncMeta(LAST_SYNCED_KEY, syncedAt);
    return { synced: true, created, updated, skipped, syncedAt, ...(errors.length > 0 ? { errors } : {}) };
  } finally {
    await releaseSyncLock();
  }
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
  const colorIdCounts: Record<string, number> = {};
  const skippedReasonCounts: Record<string, number> = {};
  const sampleEvents: GoogleSyncDebugResult['sampleEvents'] = [];
  const processedIds = new Set<string>();
  // 色による取込除外は廃止済み。件数は「全件」= includedByColor として扱う。
  let includedByColor = 0;
  const excludedByColor = 0;
  let wouldAdd = 0;
  let wouldUpdate = 0;
  let wouldDelete = 0;

  for (const item of items) {
    const colorId = getEventColorId(item);
    incrementCount(colorIdCounts, colorId);

    if (sampleEvents.length < 20) {
      sampleEvents.push({
        summary: item.summary ?? '(タイトルなし)',
        start: getEventStartForDebug(item),
        colorId,
        includedByColor: true,
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

export interface RepairGoogleColumnAlignmentResult {
  scannedSheets: number;
  repaired: number;
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
      await updateRowByHeaders(entry.sheetName, entry.dataRowIndex, eventToRecord(deletedEvent));
      cleaned++;
    }
  }

  return { scannedSheets: monthSheetNames.length, duplicateIds, cleaned };
}

function looksLikeShiftedGoogleColorId(value: string | undefined): boolean {
  return /^(default|[1-9]|1[01])$/.test((value ?? '').trim());
}

function normalizeDeletedValue(value: string | undefined): 'TRUE' | 'FALSE' {
  return value === 'TRUE' ? 'TRUE' : 'FALSE';
}

// ---- Google同期の列ズレ修復 ----
// 旧実装で source=google 行の created_at / updated_at / deleted / google_color_id が
// 1列ずつ後ろへずれたデータを補正する。
// 対象:
// - source = google
// - created_at に colorId ("default", "1"..."11") が入っている
// 補正:
// - google_color_id = created_at
// - created_at = updated_at
// - updated_at = deleted
// - deleted = google_color_id (TRUE/FALSE に正規化)
export async function repairGoogleShiftedEventColumns(): Promise<RepairGoogleColumnAlignmentResult> {
  const monthSheetNames = await getAllMonthSheetNames();
  let repaired = 0;

  for (const sheetName of monthSheetNames) {
    const rows = await getRows(sheetName);

    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      if (row.source !== 'google') continue;
      if (!looksLikeShiftedGoogleColorId(row.created_at)) continue;

      const repairedRow: Record<string, string> = {
        ...row,
        google_color_id: row.created_at ?? '',
        created_at: row.updated_at ?? '',
        updated_at: row.deleted ?? '',
        deleted: normalizeDeletedValue(row.google_color_id),
      };

      await ensureMonthSheetByName(sheetName);
      await updateRowByHeaders(sheetName, idx, repairedRow);
      repaired++;
    }
  }

  return { scannedSheets: monthSheetNames.length, repaired };
}
