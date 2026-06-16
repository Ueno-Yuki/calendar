import type { NextRequest } from 'next/server';
import { getCurrentUser, AuthError } from '@/lib/auth';
import { getSyncMeta } from '@/lib/syncMetaDb';

// GET /api/auth/google/status
// mother の Google カレンダー連携状態を返す。
// mother 以外のロールは connected: false を返す（403 は返さない）。
export async function GET(request: NextRequest) {
  let currentUser: ReturnType<typeof getCurrentUser>;
  try {
    currentUser = getCurrentUser(request);
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: '認証が必要です' }, { status: 401 });
    }
    return Response.json({ error: 'サーバーエラー' }, { status: 500 });
  }

  if (currentUser.role !== 'mother') {
    return Response.json({
      connected: false,
      lastSyncedAt: null,
      syncDisabled: process.env.DISABLE_GOOGLE_SYNC === 'true',
    });
  }

  try {
    const [token, lastSyncedAt] = await Promise.all([
      getSyncMeta('mother_google_refresh_token'),
      getSyncMeta('mother_google_calendar_last_synced_at'),
    ]);
    return Response.json({
      connected: !!token && token.trim() !== '',
      lastSyncedAt,
      syncDisabled: process.env.DISABLE_GOOGLE_SYNC === 'true',
    });
  } catch {
    return Response.json({ error: 'サーバーエラー' }, { status: 500 });
  }
}
