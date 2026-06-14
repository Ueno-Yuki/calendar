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
    return Response.json({ connected: false });
  }

  try {
    const token = await getSyncMeta('mother_google_refresh_token');
    return Response.json({ connected: !!token && token.trim() !== '' });
  } catch {
    return Response.json({ error: 'サーバーエラー' }, { status: 500 });
  }
}
