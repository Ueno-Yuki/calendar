import type { NextRequest } from 'next/server';
import { getCurrentUser, AuthError } from '@/lib/auth';
import { savePushSubscription } from '@/lib/pushSubscriptionsDb';

interface SubscribeBody {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

// POST /api/push/subscribe
// Body: { endpoint, keys: { p256dh, auth } }
// Push Subscription を push_subscriptions シートへ保存する。
// 同じ endpoint が存在する場合は更新（enabled = TRUE）。
export async function POST(request: NextRequest) {
  let currentUser: ReturnType<typeof getCurrentUser>;
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

  const b = body as Partial<SubscribeBody>;
  if (!b.endpoint || typeof b.endpoint !== 'string') {
    return Response.json({ error: 'endpoint が必要です' }, { status: 400 });
  }
  if (!b.keys?.p256dh || !b.keys?.auth) {
    return Response.json({ error: 'keys.p256dh と keys.auth が必要です' }, { status: 400 });
  }

  try {
    await savePushSubscription(
      currentUser.role,
      b.endpoint,
      b.keys.p256dh,
      b.keys.auth,
    );
    return Response.json({ ok: true }, { status: 201 });
  } catch {
    return Response.json({ error: '購読の保存に失敗しました' }, { status: 500 });
  }
}
