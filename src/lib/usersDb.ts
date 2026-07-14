import { getRows, appendRowByHeaders, updateRowByHeaders, ensureSheet } from '@/lib/sheets';
import type { FamilyRole } from '@/types';
import {
  DEFAULT_QUIET_HOURS,
  normalizeQuietHoursSettings,
  type QuietHoursSettings,
} from '@/lib/quietHours';

const SHEET = 'users';
const HEADERS = [
  'user_id', 'name', 'family_role', 'token',
  'notification_enabled', 'daily_summary_enabled',
  'instant_event_created_enabled', 'instant_event_deleted_enabled',
  'created_at', 'updated_at',
  'quiet_hours_enabled', 'quiet_hours_start', 'quiet_hours_end',
] as const;

export interface NotificationSettings extends QuietHoursSettings {
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
  ...DEFAULT_QUIET_HOURS,
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
  const quietHours = normalizeQuietHoursSettings({
    quiet_hours_enabled: row.quiet_hours_enabled !== 'FALSE',
    quiet_hours_start: row.quiet_hours_start,
    quiet_hours_end: row.quiet_hours_end,
  });
  return {
    notification_enabled: row.notification_enabled !== 'FALSE',
    daily_summary_enabled: row.daily_summary_enabled !== 'FALSE',
    instant_event_created_enabled: row.instant_event_created_enabled !== 'FALSE',
    instant_event_deleted_enabled: row.instant_event_deleted_enabled !== 'FALSE',
    ...quietHours,
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

  if (!found) {
    await appendRowByHeaders(SHEET, {
      user_id: role,
      name: '',
      family_role: role,
      token: '',
      notification_enabled: settings.notification_enabled,
      daily_summary_enabled: settings.daily_summary_enabled,
      instant_event_created_enabled: settings.instant_event_created_enabled,
      instant_event_deleted_enabled: settings.instant_event_deleted_enabled,
      created_at: now,
      updated_at: now,
      quiet_hours_enabled: settings.quiet_hours_enabled,
      quiet_hours_start: settings.quiet_hours_start,
      quiet_hours_end: settings.quiet_hours_end,
    });
  } else {
    const { row, idx } = found;
    await updateRowByHeaders(SHEET, idx, {
      ...row,
      user_id: row.user_id || role,
      name: row.name || '',
      family_role: row.family_role || role,
      token: row.token || '',
      notification_enabled: settings.notification_enabled,
      daily_summary_enabled: settings.daily_summary_enabled,
      instant_event_created_enabled: settings.instant_event_created_enabled,
      instant_event_deleted_enabled: settings.instant_event_deleted_enabled,
      created_at: row.created_at || now,
      updated_at: now,
      quiet_hours_enabled: settings.quiet_hours_enabled,
      quiet_hours_start: settings.quiet_hours_start,
      quiet_hours_end: settings.quiet_hours_end,
    });
  }
}
