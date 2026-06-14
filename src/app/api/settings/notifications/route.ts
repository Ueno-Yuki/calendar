import type { NextRequest } from 'next/server';
import { getCurrentUser, AuthError } from '@/lib/auth';
import {
  getNotificationSettings,
  upsertNotificationSettings,
  type NotificationSettings,
} from '@/lib/usersDb';

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
// Body: { notification_enabled, daily_summary_enabled, instant_event_created_enabled, instant_event_deleted_enabled }
// 未指定フィールドは true (デフォルト有効) として扱う。
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
  const settings: NotificationSettings = {
    notification_enabled: b.notification_enabled !== false,
    daily_summary_enabled: b.daily_summary_enabled !== false,
    instant_event_created_enabled: b.instant_event_created_enabled !== false,
    instant_event_deleted_enabled: b.instant_event_deleted_enabled !== false,
  };

  try {
    await upsertNotificationSettings(currentUser.role, settings);
    return Response.json(settings);
  } catch {
    return Response.json({ error: '設定の保存に失敗しました' }, { status: 500 });
  }
}
