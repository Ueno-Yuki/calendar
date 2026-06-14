import type { NextRequest } from 'next/server';
import { getCurrentUser, AuthError } from '@/lib/auth';
import { disablePushSubscription } from '@/lib/pushSubscriptionsDb';

// POST /api/push/unsubscribe
// Body: { endpoint }
// 該当 endpoint の enabled を FALSE に更新する。
export async function POST(request: NextRequest) {
  try {
    getCurrentUser(request);
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

  const b = body as { endpoint?: unknown };
  if (!b.endpoint || typeof b.endpoint !== 'string') {
    return Response.json({ error: 'endpoint が必要です' }, { status: 400 });
  }

  try {
    await disablePushSubscription(b.endpoint);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: '購読解除の更新に失敗しました' }, { status: 500 });
  }
}
