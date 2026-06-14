import { getRows, appendRow, updateRow, ensureSheet } from '@/lib/sheets';
import type { FamilyRole } from '@/types';

const SHEET = 'users';
const HEADERS = [
  'user_id', 'name', 'family_role', 'token',
  'notification_enabled', 'daily_summary_enabled',
  'instant_event_created_enabled', 'instant_event_deleted_enabled',
  'created_at', 'updated_at',
] as const;

export interface NotificationSettings {
  notification_enabled: boolean;
  daily_summary_enabled: boolean;
  instant_event_created_enabled: boolean;
  instant_event_deleted_enabled: boolean;
}

const DEFAULT_SETTINGS: NotificationSettings = {
  notification_enabled: true,
  daily_summary_enabled: true,
  instant_event_created_enabled: true,
  instant_event_deleted_enabled: true,
};

async function ensureUsersSheet(): Promise<void> {
  await ensureSheet(SHEET, HEADERS);
}

/** users シートから family_role でユーザー行を検索 */
async function findUserRow(
  role: FamilyRole,
): Promise<{ row: Record<string, string>; idx: number } | null> {
  const rows = await getRows(SHEET);
  const idx = rows.findIndex((r) => r.family_role === role || r.user_id === role);
  if (idx === -1) return null;
  return { row: rows[idx], idx };
}

/**
 * 指定ロールの通知設定を取得する。
 * ユーザー行が存在しない場合はデフォルト値を返す。
 */
export async function getNotificationSettings(role: FamilyRole): Promise<NotificationSettings> {
  await ensureUsersSheet();
  const found = await findUserRow(role);
  if (!found) return { ...DEFAULT_SETTINGS };
  const { row } = found;
  return {
    notification_enabled: row.notification_enabled !== 'FALSE',
    daily_summary_enabled: row.daily_summary_enabled !== 'FALSE',
    instant_event_created_enabled: row.instant_event_created_enabled !== 'FALSE',
    instant_event_deleted_enabled: row.instant_event_deleted_enabled !== 'FALSE',
  };
}

/**
 * 指定ロールの通知設定を更新する。
 * ユーザー行が存在しない場合は新規作成する（token は環境変数で管理するため空）。
 */
export async function upsertNotificationSettings(
  role: FamilyRole,
  settings: NotificationSettings,
): Promise<void> {
  await ensureUsersSheet();
  const found = await findUserRow(role);
  const now = new Date().toISOString();
  const b = (v: boolean) => (v ? 'TRUE' : 'FALSE');

  if (!found) {
    await appendRow(SHEET, [
      role, '', role, '',
      b(settings.notification_enabled),
      b(settings.daily_summary_enabled),
      b(settings.instant_event_created_enabled),
      b(settings.instant_event_deleted_enabled),
      now, now,
    ]);
  } else {
    const { row, idx } = found;
    await updateRow(SHEET, idx, [
      row.user_id || role,
      row.name || '',
      row.family_role || role,
      row.token || '',
      b(settings.notification_enabled),
      b(settings.daily_summary_enabled),
      b(settings.instant_event_created_enabled),
      b(settings.instant_event_deleted_enabled),
      row.created_at || now,
      now,
    ]);
  }
}
