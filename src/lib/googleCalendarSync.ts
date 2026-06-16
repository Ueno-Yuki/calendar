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
  reason?: string;
}

// ページネーション付きで Google Calendar イベントを取得
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

/**
 * google_event_id → { event, sheetName, dataRowIndex } のマップを構築する。
 *
 * 【修正内容】
 * - スプレッドシート内の全 YYYY-MM シートを検索対象にする（旧: ±12ヶ月のみ）
 *   → 2028年など遠い未来の予定も重複チェックの対象になる
 * - 同一 google_event_id が複数行ある場合: 非削除 > 削除、updated_at 新しい方を優先
 */
async function buildGoogleEventIdMap(): Promise<
  Map<string, { event: Event; sheetName: string; dataRowIndex: number }>
> {
  const map = new Map<string, { event: Event; sheetName: string; dataRowIndex: number }>();
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
        // 同一IDが複数行: 非削除を優先し、同条件なら updated_at が新しい方を残す
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

function todayTimeMin(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.toISOString().slice(0, 10)}T00:00:00+09:00`;
}

// ---- 初回取り込み ----
// OAuth認証完了直後に一度だけ実行する。
// mother_google_import_completed = TRUE の場合はスキップ。
// DISABLE_GOOGLE_SYNC=true の場合は何もしない。

export async function importGoogleCalendar(): Promise<SyncResult> {
  if (isSyncDisabled()) {
    return { synced: false, added: 0, updated: 0, deleted: 0, syncedAt: '', reason: 'sync_disabled' };
  }

  const importCompleted = await getSyncMeta(IMPORT_COMPLETED_KEY);
  if (importCompleted === 'TRUE') {
    return { synced: false, added: 0, updated: 0, deleted: 0, syncedAt: '', reason: 'already_imported' };
  }

  const calendar = await getAuthorizedCalendar();
  if (!calendar) {
    return { synced: false, added: 0, updated: 0, deleted: 0, syncedAt: '', reason: 'not_connected' };
  }

  const items = await listGCalItems(calendar, {
    calendarId: CALENDAR_ID(),
    timeMin: todayTimeMin(),
    singleEvents: true,
    maxResults: 2500,
    showDeleted: false,
  });

  const existingMap = await buildGoogleEventIdMap();
  const syncedAt = new Date().toISOString();
  const processedIds = new Set<string>(); // 同一同期内の重複防止
  let added = 0;

  for (const item of items) {
    if (!item.id) continue;
    if (processedIds.has(item.id)) continue; // 同一IDの二重処理を防ぐ
    processedIds.add(item.id);

    if (existingMap.has(item.id)) continue; // 全月シートに既存 → スキップ

    const parsed = parseGCalEvent(item);
    if (!parsed) continue;

    const [yearStr, monthStr] = parsed.start_date.split('-');
    const year = parseInt(yearStr);
    const month = parseInt(monthStr);
    await ensureMonthSheet(year, month);

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
      created_at: syncedAt,
      updated_at: syncedAt,
      deleted: false,
    };

    await appendRow(getMonthSheetName(year, month), eventToValues(event));
    added++;
  }

  await setSyncMeta(IMPORT_COMPLETED_KEY, 'TRUE');
  await setSyncMeta(LAST_SYNCED_KEY, syncedAt);

  return { synced: true, added, updated: 0, deleted: 0, syncedAt };
}

// ---- 通常同期 Google → アプリ ----
// クライアントが POST /api/sync/google を呼んだ時に実行する。
// DISABLE_GOOGLE_SYNC=true の場合は何もしない。

export async function syncGoogleToApp(): Promise<SyncResult> {
  if (isSyncDisabled()) {
    return { synced: false, added: 0, updated: 0, deleted: 0, syncedAt: '', reason: 'sync_disabled' };
  }

  const calendar = await getAuthorizedCalendar();
  if (!calendar) {
    return { synced: false, added: 0, updated: 0, deleted: 0, syncedAt: '', reason: 'not_connected' };
  }

  // 削除済み含めて取得することで Google 側の削除を検知できる
  const items = await listGCalItems(calendar, {
    calendarId: CALENDAR_ID(),
    timeMin: todayTimeMin(),
    singleEvents: true,
    maxResults: 2500,
    showDeleted: true,
  });

  const existingMap = await buildGoogleEventIdMap();
  const syncedAt = new Date().toISOString();
  const processedIds = new Set<string>(); // 同一同期内の重複防止
  let added = 0;
  let updated = 0;
  let deleted = 0;

  for (const item of items) {
    if (!item.id) continue;
    if (processedIds.has(item.id)) continue; // 同一IDの二重処理を防ぐ
    processedIds.add(item.id);

    const existing = existingMap.get(item.id);

    if (item.status === 'cancelled') {
      // Google 側で削除 → アプリ側も論理削除
      if (existing && !existing.event.deleted) {
        const deletedEvent: Event = { ...existing.event, deleted: true, updated_at: syncedAt };
        await updateRow(existing.sheetName, existing.dataRowIndex, eventToValues(deletedEvent));
        deleted++;
      }
      continue;
    }

    const parsed = parseGCalEvent(item);
    if (!parsed) continue;

    if (!existing) {
      // 新規: 全月シートに存在しない場合のみ append
      const [yearStr, monthStr] = parsed.start_date.split('-');
      const year = parseInt(yearStr);
      const month = parseInt(monthStr);
      await ensureMonthSheet(year, month);

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
        created_at: syncedAt,
        updated_at: syncedAt,
        deleted: false,
      };

      await appendRow(getMonthSheetName(year, month), eventToValues(newEvent));
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
        e.memo !== parsed.memo;

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
          updated_at: syncedAt,
        };
        await updateRow(existing.sheetName, existing.dataRowIndex, eventToValues(updatedEvent));
        updated++;
      }
    }
  }

  if (added + updated + deleted > 0) {
    await setSyncMeta('events_last_updated_at', syncedAt);
  }
  await setSyncMeta(LAST_SYNCED_KEY, syncedAt);
  return { synced: true, added, updated, deleted, syncedAt };
}

// ---- 重複クリーンアップ ----
// source=google かつ google_event_id が空でない行を全月シートから収集し、
// 同一 google_event_id が複数行ある場合に updated_at 最新の1件を残して他を論理削除する。

export interface CleanupResult {
  scannedSheets: number;
  duplicateIds: number;
  cleaned: number;
}

export async function cleanupGoogleDuplicates(): Promise<CleanupResult> {
  const monthSheetNames = await getAllMonthSheetNames();

  // 全シートの行をキャッシュしながら google_event_id 別にグループ化
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
      await updateRow(entry.sheetName, entry.dataRowIndex, eventToValues(deletedEvent));
      cleaned++;
    }
  }

  return { scannedSheets: monthSheetNames.length, duplicateIds, cleaned };
}
