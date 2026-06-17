import type { Event, FamilyRole, EventSource } from '@/types';
import { getRows, getMonthSheetName, EVENT_HEADERS } from '@/lib/sheets';

// 複数日予定は start_date の月シートに保存する。
// そのため、対象月の予定取得時は「前月 + 当月」を参照することで、
// 前月開始・当月終了の月跨ぎ予定を取得できる。

export function parseEventRow(row: Record<string, string>): Event {
  return {
    id: row.id ?? '',
    owner: (row.owner as FamilyRole) ?? 'me',
    person: (row.person as FamilyRole) ?? 'me',
    title: row.title ?? '',
    start_date: row.start_date ?? '',
    end_date: row.end_date ?? '',
    start_time: row.start_time ?? '',
    end_time: row.end_time ?? '',
    location: row.location ?? '',
    memo: row.memo ?? '',
    all_day: row.all_day === 'TRUE',
    source: (row.source as EventSource) ?? 'manual',
    google_event_id: row.google_event_id ?? '',
    google_color_id: row.google_color_id ?? '',
    created_at: row.created_at ?? '',
    updated_at: row.updated_at ?? '',
    deleted: row.deleted === 'TRUE',
  };
}

/** Event をヘッダー名ベースの record に変換する */
export function eventToRecord(event: Event): Record<string, string> {
  const record: Record<string, string> = {};
  (EVENT_HEADERS as readonly string[]).forEach((header) => {
    const value = event[header as keyof Event];
    record[header] = typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : String(value ?? '');
  });
  return record;
}

export function isValidDeletedCell(value: string | undefined): boolean {
  return value === undefined || value === '' || value === 'TRUE' || value === 'FALSE';
}

/**
 * イベント ID でイベントを検索する。
 * hintYear / hintMonth が指定されていればそのシートのみを検索し、
 * 指定がなければ現在月 ±3 か月をフォールバックとして検索する。
 *
 * PUT / DELETE では year/month クエリパラメータを渡すことを原則とする。
 * year/month がない場合の現在月±3か月検索はフォールバックであり、
 * 通常利用では使わない。
 */
export async function findEventById(
  id: string,
  hintYear?: number,
  hintMonth?: number,
): Promise<{ event: Event; sheetName: string; dataRowIndex: number } | null> {
  const sheetsToSearch: string[] = [];

  if (hintYear && hintMonth) {
    sheetsToSearch.push(getMonthSheetName(hintYear, hintMonth));
  } else {
    const now = new Date();
    for (let offset = -3; offset <= 3; offset++) {
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      sheetsToSearch.push(getMonthSheetName(d.getFullYear(), d.getMonth() + 1));
    }
  }

  for (const sheetName of sheetsToSearch) {
    const rows = await getRows(sheetName);
    const idx = rows.findIndex((r) => r.id === id);
    if (idx !== -1) {
      return { event: parseEventRow(rows[idx]), sheetName, dataRowIndex: idx };
    }
  }

  return null;
}
