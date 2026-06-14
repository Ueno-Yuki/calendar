import { getRows, appendRow, ensureSheet } from '@/lib/sheets';

const SHEET = 'notification_logs';
const HEADERS = [
  'id', 'type', 'event_id', 'date', 'target_user_id',
  'scheduled_at', 'sent_at', 'status', 'error_message', 'created_at',
] as const;

export interface NotificationLogEntry {
  type: 'event_created' | 'event_deleted' | 'daily_summary';
  event_id: string;
  date: string;
  target_user_id: string;
  scheduled_at: string;
  sent_at: string;
  status: 'sent' | 'failed' | 'skipped';
  error_message: string;
}

/**
 * 指定日・ユーザーへの daily_summary が既に sent 状態で記録されているか確認する。
 * sent がある = 重複送信を防ぐ。failed / skipped は再送候補として扱う。
 */
export async function hasDailySummarySent(date: string, userId: string): Promise<boolean> {
  await ensureSheet(SHEET, HEADERS);
  const rows = await getRows(SHEET);
  return rows.some(
    (r) =>
      r.type === 'daily_summary' &&
      r.date === date &&
      r.target_user_id === userId &&
      r.status === 'sent',
  );
}

export async function appendNotificationLog(entry: NotificationLogEntry): Promise<void> {
  await ensureSheet(SHEET, HEADERS);
  const now = new Date().toISOString();
  await appendRow(SHEET, [
    crypto.randomUUID(),
    entry.type,
    entry.event_id,
    entry.date,
    entry.target_user_id,
    entry.scheduled_at,
    entry.sent_at,
    entry.status,
    entry.error_message,
    now,
  ]);
}
