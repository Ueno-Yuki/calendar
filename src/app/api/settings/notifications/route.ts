import type { NextRequest } from 'next/server';
import { getCurrentUser, AuthError } from '@/lib/auth';
import {
  getNotificationSettings,
  upsertNotificationSettings,
  type NotificationSettings,
} from '@/lib/usersDb';
import { DEFAULT_QUIET_HOURS, isValidTime } from '@/lib/quietHours';

// GET /api/settings/notifications
// 現在の利用者の通知設定を返す。users シートに行がなければデフォルト値を返す。
export async function GET(request: NextRequest) {
  let currentUser: { role: Parameters<typeof getNotificationSettings>[0] };
  try {
    currentUser = getCurrentUser(request);
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: '認証が必要です' }, { status: 401 });
    }
    return Response.json({ error: 'サーバーエラー' }, { status: 500 });
  }

  try {
    const settings = await getNotificationSettings(currentUser.role);
    return Response.json(settings);
  } catch {
    return Response.json({ error: '設定の取得に失敗しました' }, { status: 500 });
  }
}

// PUT /api/settings/notifications
// Body: { notification_enabled, daily_summary_enabled, instant_event_created_enabled,
// instant_event_deleted_enabled, quiet_hours_enabled, quiet_hours_start, quiet_hours_end }
// 未指定フィールドは現在値（行がなければデフォルト値）を維持する。
export async function PUT(request: NextRequest) {
  let currentUser: { role: Parameters<typeof upsertNotificationSettings>[0] };
  try {
    currentUser = getCurrentUser(request);
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: '認証が必要です' }, { status: 401 });
    }
    return Response.json({ error: 'サーバーエラー' }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'リクエストボディのパースに失敗しました' }, { status: 400 });
  }

  const b = body as Partial<NotificationSettings>;
  if (b.quiet_hours_start !== undefined && !isValidTime(b.quiet_hours_start)) {
    return Response.json({ error: 'quiet_hours_start は HH:MM 形式で指定してください' }, { status: 400 });
  }
  if (b.quiet_hours_end !== undefined && !isValidTime(b.quiet_hours_end)) {
    return Response.json({ error: 'quiet_hours_end は HH:MM 形式で指定してください' }, { status: 400 });
  }

  try {
    const current = await getNotificationSettings(currentUser.role);
    const settings: NotificationSettings = {
      notification_enabled: b.notification_enabled ?? current.notification_enabled,
      daily_summary_enabled: b.daily_summary_enabled ?? current.daily_summary_enabled,
      instant_event_created_enabled:
        b.instant_event_created_enabled ?? current.instant_event_created_enabled,
      instant_event_deleted_enabled:
        b.instant_event_deleted_enabled ?? current.instant_event_deleted_enabled,
      quiet_hours_enabled:
        b.quiet_hours_enabled ?? current.quiet_hours_enabled ?? DEFAULT_QUIET_HOURS.quiet_hours_enabled,
      quiet_hours_start:
        b.quiet_hours_start ?? current.quiet_hours_start ?? DEFAULT_QUIET_HOURS.quiet_hours_start,
      quiet_hours_end:
        b.quiet_hours_end ?? current.quiet_hours_end ?? DEFAULT_QUIET_HOURS.quiet_hours_end,
    };
    await upsertNotificationSettings(currentUser.role, settings);
    return Response.json(settings);
  } catch {
    return Response.json({ error: '設定の保存に失敗しました' }, { status: 500 });
  }
}
