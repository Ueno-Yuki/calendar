import type { calendar_v3 } from 'googleapis';
import type { Event } from '@/types';
import {
  getRows,
  appendRow,
  updateRow,
  getMonthSheetName,
  ensureMonthSheet,
} from '@/lib/sheets';
import { parseEventRow, eventToValues } from '@/lib/eventsDb';
import { getSyncMeta, setSyncMeta } from '@/lib/syncMetaDb';
import { getAuthorizedCalendar, parseGCalEvent } from '@/lib/googleCalendar';

const LAST_SYNCED_KEY = 'mother_google_calendar_last_synced_at';
const IMPORT_COMPLETED_KEY = 'mother_google_import_completed';
const CALENDAR_ID = () => process.env.GOOGLE_CALENDAR_ID_MOTHER ?? 'primary';

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

// google_event_id → { event, sheetName, dataRowIndex } のマップを構築
// 今月の -1 ヶ月 から +12 ヶ月 を検索対象とする
async function buildGoogleEventIdMap(): Promise<
  Map<string, { event: Event; sheetName: string; dataRowIndex: number }>
> {
  const map = new Map<string, { event: Event; sheetName: string; dataRowIndex: number }>();
  const now = new Date();

  for (let offset = -1; offset <= 12; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const sheetName = getMonthSheetName(d.getFullYear(), d.getMonth() + 1);
    const rows = await getRows(sheetName);
    rows.forEach((row, idx) => {
      if (row.google_event_id) {
        map.set(row.google_event_id, {
          event: parseEventRow(row),
          sheetName,
          dataRowIndex: idx,
        });
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

export async function importGoogleCalendar(): Promise<SyncResult> {
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
  let added = 0;

  for (const item of items) {
    if (!item.id) continue;
    if (existingMap.has(item.id)) continue; // 重複スキップ

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

export async function syncGoogleToApp(): Promise<SyncResult> {
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
  let added = 0;
  let updated = 0;
  let deleted = 0;

  for (const item of items) {
    if (!item.id) continue;
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
      // 新規: アプリに追加
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
