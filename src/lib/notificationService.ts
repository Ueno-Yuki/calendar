import type { Event, FamilyRole } from '@/types';
import { VALID_ROLES } from '@/lib/auth';
import { getEnabledSubscriptions, disablePushSubscription } from '@/lib/pushSubscriptionsDb';
import { getNotificationSettings } from '@/lib/usersDb';
import { sendPushToSubscription } from '@/lib/webPush';
import { appendNotificationLog } from '@/lib/notificationsDb';
import { isInQuietHours } from '@/lib/quietHours';

const DAY_OF_WEEK = ['日', '月', '火', '水', '木', '金', '土'] as const;

function formatDate(dateStr: string): string {
  // dateStr: YYYY-MM-DD
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${m}/${d}(${DAY_OF_WEEK[date.getDay()]})`;
}

/** 通知 body テキストを生成する */
function buildNotificationBody(event: Event): string {
  const isMultiDay = event.start_date !== event.end_date;

  let timeStr: string;
  if (isMultiDay) {
    timeStr = `${formatDate(event.start_date)}〜${formatDate(event.end_date)}`;
  } else if (event.all_day) {
    timeStr = formatDate(event.start_date);
  } else {
    timeStr = formatDate(event.start_date);
    if (event.start_time) {
      timeStr += ` ${event.start_time}`;
      if (event.end_time) {
        timeStr += `〜${event.end_time}`;
      }
    }
  }

  return `${timeStr}\n${event.title}`;
}

/**
 * 予定追加・削除時に操作者以外の家族へ即時Push通知を送信する。
 * 通知送信失敗は notification_logs に記録するが、呼び出し元へは伝播させない。
 */
export async function sendInstantNotification(
  type: 'event_created' | 'event_deleted',
  event: Event,
  operatorRole: FamilyRole,
): Promise<void> {
  const [subscriptions, ...settingsArr] = await Promise.all([
    getEnabledSubscriptions(),
    ...VALID_ROLES.filter((r) => r !== operatorRole).map((r) => getNotificationSettings(r)),
  ]);

  // role → settings マップ
  const settingsMap: Partial<Record<FamilyRole, Awaited<ReturnType<typeof getNotificationSettings>>>> = {};
  VALID_ROLES.filter((r) => r !== operatorRole).forEach((r, i) => {
    settingsMap[r] = settingsArr[i];
  });

  const notificationTitle = type === 'event_created' ? '予定が追加されました' : '予定が削除されました';
  const body = buildNotificationBody(event);
  const url = `/?date=${event.start_date}`;
  const payload = JSON.stringify({ title: notificationTitle, body, url });
  const now = new Date().toISOString();

  // 通知設定でフィルタした送信対象購読リスト
  const eligibleSubs = subscriptions.filter((sub) => {
    const role = sub.userId as FamilyRole;
    if (!VALID_ROLES.includes(role) || role === operatorRole) return false;
    const settings = settingsMap[role];
    if (!settings?.notification_enabled) return false;
    if (type === 'event_created' && !settings.instant_event_created_enabled) return false;
    if (type === 'event_deleted' && !settings.instant_event_deleted_enabled) return false;
    return true;
  });

  const sendTasks = eligibleSubs.map((sub) => {
    const settings = settingsMap[sub.userId as FamilyRole];

    // 対象ユーザーのお休みモード中は送信せずにログを記録して正常終了
    if (settings && isInQuietHours(settings)) {
      return appendNotificationLog({
        type,
        event_id: event.id,
        date: event.start_date,
        target_user_id: sub.userId,
        scheduled_at: now,
        sent_at: now,
        status: 'skipped',
        error_message: 'quiet_hours',
      }).catch(() => {});
    }

    return sendPushToSubscription(sub, payload)
      .then(() =>
        appendNotificationLog({
          type,
          event_id: event.id,
          date: event.start_date,
          target_user_id: sub.userId,
          scheduled_at: now,
          sent_at: new Date().toISOString(),
          status: 'sent',
          error_message: '',
        }).catch(() => {}),
      )
      .catch((err: unknown) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        // 410 Gone はEndpointが失効 → 購読を無効化
        if (errorMessage.includes('410') || errorMessage.includes('Gone')) {
          disablePushSubscription(sub.endpoint).catch(() => {});
        }
        appendNotificationLog({
          type,
          event_id: event.id,
          date: event.start_date,
          target_user_id: sub.userId,
          scheduled_at: now,
          sent_at: new Date().toISOString(),
          status: 'failed',
          error_message: errorMessage.slice(0, 500),
        }).catch(() => {});
      });
  });

  await Promise.allSettled(sendTasks);
}
