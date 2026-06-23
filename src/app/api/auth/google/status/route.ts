import type { NextRequest } from 'next/server';
import { getCurrentUser, AuthError } from '@/lib/auth';
import { getAllSyncMeta } from '@/lib/syncMetaDb';

function canUseMotherGoogleSync(role: ReturnType<typeof getCurrentUser>['role']): boolean {
  return role === 'mother' || role === 'me';
}

// GET /api/auth/google/status
// 母の Google カレンダー連携状態を返す。
// 同期操作を許可しないロールは connected: false を返す（403 は返さない）。
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

  if (!canUseMotherGoogleSync(currentUser.role)) {
    return Response.json({
      connected: false,
      lastSyncedAt: null,
      syncDisabled: process.env.DISABLE_GOOGLE_SYNC === 'true',
    });
  }

  try {
    const syncMeta = await getAllSyncMeta();
    const token = syncMeta.get('mother_google_refresh_token') ?? null;
    const lastSyncedAt = syncMeta.get('mother_google_calendar_last_synced_at') ?? null;
    return Response.json({
      connected: !!token && token.trim() !== '',
      lastSyncedAt,
      syncDisabled: process.env.DISABLE_GOOGLE_SYNC === 'true',
    });
  } catch {
    return Response.json({ error: 'サーバーエラー' }, { status: 500 });
  }
}
