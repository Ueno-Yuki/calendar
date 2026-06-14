import type { Event } from '@/types';
import { VALID_ROLES } from '@/lib/auth';
import { getRows, getMonthSheetName } from '@/lib/sheets';
import { parseEventRow } from '@/lib/eventsDb';
import { getEnabledSubscriptions, disablePushSubscription } from '@/lib/pushSubscriptionsDb';
import { getNotificationSettings } from '@/lib/usersDb';
import { sendPushToSubscription } from '@/lib/webPush';
import { appendNotificationLog, hasDailySummarySent } from '@/lib/notificationsDb';
import { isQuietHoursJst } from '@/lib/notificationService';
import { isKappaShiftLast } from '@/lib/kappaShift';
import { FAMILY_COLORS } from '@/lib/colors';

// ---- JST ユーティリティ ----

/** 現在時刻を JST (UTC+9) に変換した Date を返す */
function getNowJst(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

/** JST 今日の日付を YYYY-MM-DD で返す */
export function getTodayJst(): string {
  const jst = getNowJst();
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ---- 今日の予定取得 ----

/**
 * JST 今日の通知対象予定を取得する。
 * - 当月シート + 前月シートの両方を参照（前月開始・当月終了の複数日予定を拾うため）
 * - deleted = TRUE は除外
 * - 複数日予定（start_date !== end_date）は開始日・終了日のみ対象。中間日は除外
 */
export async function getTodayEvents(today: string): Promise<Event[]> {
  const [y, m] = today.split('-').map(Number);
  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;

  const [currentRows, prevRows] = await Promise.all([
    getRows(getMonthSheetName(y, m)),
    getRows(getMonthSheetName(prevY, prevM)),
  ]);

  return [...prevRows, ...currentRows]
    .map(parseEventRow)
    .filter((e) => {
      if (e.deleted) return false;
      if (e.start_date > today || e.end_date < today) return false;
      if (e.start_date !== e.end_date) {
        // 複数日予定: 開始日・終了日のみ通知対象
        return e.start_date === today || e.end_date === today;
      }
      return true;
    });
}

// ---- 通知本文構築 ----

const MAX_ITEMS = 5;

/**
 * 今日の予定サマリー通知本文を生成する。
 * - 時間指定予定: 開始時刻昇順
 * - 終日予定: 最後
 * - ラスト予定: "HH:MM〜ラスト" 形式
 * - 全体で最大 MAX_ITEMS 件、超過分は "ほかN件" 表示
 */
export function buildDailySummaryBody(events: Event[]): string {
  const timed = events
    .filter((e) => !e.all_day && e.start_time)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

  const allDay = events.filter((e) => e.all_day || !e.start_time);

  const ordered = [...timed, ...allDay];
  const shown = ordered.slice(0, MAX_ITEMS);
  const extra = ordered.length - shown.length;

  const lines = shown.map((event) => {
    const label = FAMILY_COLORS[event.person]?.label ?? event.person;
    if (!event.all_day && event.start_time) {
      const timeStr = isKappaShiftLast(event)
        ? `${event.start_time}〜ラスト`
        : event.start_time;
      return `${timeStr} ${label} ${event.title}`;
    }
    return `終日 ${label} ${event.title}`;
  });

  if (extra > 0) lines.push(`ほか${extra}件`);

  return lines.join('\n');
}

// ---- メイン処理 ----

/**
 * 今日の予定サマリー通知を実行する。
 * Vercel Cron（毎日 UTC 23:00 = JST 08:00）から呼ばれる想定。
 * - 予定が0件の日は何もしない
 * - 送信失敗は notification_logs に記録するが呼び出し元へは伝播させない
 * - 1ユーザーの失敗が他ユーザーの通知を止めない
 */
export async function runDailySummary(): Promise<void> {
  const today = getTodayJst();

  // 今日の予定取得
  const todayEvents = await getTodayEvents(today);
  if (todayEvents.length === 0) return;

  // 通知ペイロード（全ユーザー共通）
  const body = buildDailySummaryBody(todayEvents);
  const payload = JSON.stringify({
    title: '今日の予定',
    body,
    url: `/?date=${today}`,
  });

  const now = new Date().toISOString();
  const quiet = isQuietHoursJst();

  // 購読情報と通知設定を並列取得
  const [subscriptions, ...settingsArr] = await Promise.all([
    getEnabledSubscriptions(),
    ...VALID_ROLES.map((r) => getNotificationSettings(r)),
  ]);

  const settingsMap = Object.fromEntries(VALID_ROLES.map((r, i) => [r, settingsArr[i]]));

  // ユーザーごとに独立して送信（Promise.allSettled で一人の失敗が他を止めない）
  const userTasks = VALID_ROLES.map(async (role) => {
    const settings = settingsMap[role];
    if (!settings.notification_enabled || !settings.daily_summary_enabled) return;

    const userSubs = subscriptions.filter((s) => s.userId === role);
    if (userSubs.length === 0) return;

    // 重複送信チェック（同日・同ユーザーへの sent が存在する場合はスキップ）
    const alreadySent = await hasDailySummarySent(today, role);
    if (alreadySent) return;

    // サブスクリプションごとに送信
    for (const sub of userSubs) {
      if (quiet) {
        appendNotificationLog({
          type: 'daily_summary',
          event_id: '',
          date: today,
          target_user_id: role,
          scheduled_at: now,
          sent_at: now,
          status: 'skipped',
          error_message: 'quiet_hours',
        }).catch(() => {});
        continue;
      }

      try {
        await sendPushToSubscription(sub, payload);
        appendNotificationLog({
          type: 'daily_summary',
          event_id: '',
          date: today,
          target_user_id: role,
          scheduled_at: now,
          sent_at: new Date().toISOString(),
          status: 'sent',
          error_message: '',
        }).catch(() => {});
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (errorMessage.includes('410') || errorMessage.includes('Gone')) {
          disablePushSubscription(sub.endpoint).catch(() => {});
        }
        appendNotificationLog({
          type: 'daily_summary',
          event_id: '',
          date: today,
          target_user_id: role,
          scheduled_at: now,
          sent_at: new Date().toISOString(),
          status: 'failed',
          error_message: errorMessage.slice(0, 500),
        }).catch(() => {});
      }
    }
  });

  await Promise.allSettled(userTasks);
}
