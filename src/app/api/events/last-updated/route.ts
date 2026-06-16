import type { NextRequest } from 'next/server';
import { getCurrentUser, AuthError } from '@/lib/auth';
import { getSyncMeta } from '@/lib/syncMetaDb';

// GET /api/events/last-updated
// クライアントのポーリングが使う。events_last_updated_at を返す。
export async function GET(request: NextRequest) {
  try {
    getCurrentUser(request);
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: '認証が必要です' }, { status: 401 });
    }
    return Response.json({ error: 'サーバーエラー' }, { status: 500 });
  }

  try {
    const lastUpdatedAt = await getSyncMeta('events_last_updated_at');
    return Response.json({ lastUpdatedAt });
  } catch {
    return Response.json({ error: 'サーバーエラー' }, { status: 500 });
  }
}
