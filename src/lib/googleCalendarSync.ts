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

// ---- 型エイリアス ----

type ExistingEntry = { event: Event; sheetName: string; dataRowIndex: number };

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

// ---- 日付ヘルパー ----

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// JST基準の現在年を返す
function jstCurrentYear(): number {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCFullYear();
}

// 初回取り込み用: Asia/Tokyo基準の当年のみ
// timeMin = YYYY-01-01T00:00:00+09:00, timeMax = (YYYY+1)-01-01T00:00:00+09:00
function jstYearRange(year: number): { timeMin: string; timeMax: string } {
  return {
    timeMin: `${year}-01-01T00:00:00+09:00`,
    timeMax: `${year + 1}-01-01T00:00:00+09:00`,
  };
}

// 通常同期用: 表示月の前月1日〜翌々月1日（3ヶ月ウィンドウ）
// 例: 表示月 2026-06 → 2026-05-01 〜 2026-08-01
function displayMonthRange(year: number, month: number): { timeMin: string; timeMax: string } {
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const rawAfterNext = month + 2;
  const afterNextYear = rawAfterNext > 12 ? year + 1 : year;
  const afterNextMonth = rawAfterNext > 12 ? rawAfterNext - 12 : rawAfterNext;
  return {
    timeMin: `${prevYear}-${pad2(prevMonth)}-01T00:00:00+09:00`,
    timeMax: `${afterNextYear}-${pad2(afterNextMonth)}-01T00:00:00+09:00`,
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

    const { timeMin, timeMax } = jstYearRange(jstCurrentYear());
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
// クライアントが POST /api/sync/google?year=YYYY&month=M を呼んだ時に実行する。
// 取得範囲: 表示月の前月1日〜翌々月1日（3ヶ月ウィンドウ、繰り返し予定の大量取得を防ぐ）
// DISABLE_GOOGLE_SYNC=true の場合は何もしない。

export async function syncGoogleToApp(displayYear: number, displayMonth: number): Promise<SyncResult> {
  if (isSyncDisabled()) {
    return { synced: false, added: 0, updated: 0, deleted: 0, syncedAt: '', reason: 'sync_disabled' };
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

    const { timeMin, timeMax } = displayMonthRange(displayYear, displayMonth);
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

      const existing = existingMap.get(item.id);

      if (item.status === 'cancelled') {
        // Google 側で削除 → アプリ側も論理削除
        if (existing && !existing.event.deleted) {
          const deletedEvent: Event = { ...existing.event, deleted: true, updated_at: syncedAt };
          await updateRow(existing.sheetName, existing.dataRowIndex, eventToValues(deletedEvent));
          existingMap.set(item.id, { ...existing, event: deletedEvent }); // マップ更新
          deleted++;
        }
        continue;
      }

      const parsed = parseGCalEvent(item);
      if (!parsed) continue;

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
          existingMap.set(item.id, { ...existing, event: updatedEvent }); // マップ更新
          updated++;
        }
      }
    }

    if (added + updated + deleted > 0) {
      await setSyncMeta('events_last_updated_at', syncedAt);
    }
    await setSyncMeta(LAST_SYNCED_KEY, syncedAt);
    return { synced: true, added, updated, deleted, syncedAt };
  } finally {
    await releaseSyncLock();
  }
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
      await updateRow(entry.sheetName, entry.dataRowIndex, eventToValues(deletedEvent));
      cleaned++;
    }
  }

  return { scannedSheets: monthSheetNames.length, duplicateIds, cleaned };
}
