import type { NextRequest } from 'next/server';
import { getCurrentUser, AuthError } from '@/lib/auth';
import { getSyncMeta } from '@/lib/syncMetaDb';
import { debugGoogleSync, parseGoogleSyncColorIds, syncGoogleToApp } from '@/lib/googleCalendarSync';

const LAST_SYNCED_KEY = 'mother_google_calendar_last_synced_at';
const SYNC_INTERVAL_MS = 10 * 60 * 1000; // 10分

function canUseMotherGoogleSync(role: ReturnType<typeof getCurrentUser>['role']): boolean {
  return role === 'mother' || role === 'me';
}

// POST /api/sync/google
// Google → アプリ の手動同期エンドポイント。
// 取得範囲は syncGoogleToApp() 内で現在日時から当年末まで (JST)。
// 最終同期から10分未満の場合は実行しない（?force=true で強制実行可）。
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

  if (!canUseMotherGoogleSync(currentUser.role)) {
    return Response.json({ synced: false, reason: 'forbidden' }, { status: 403 });
  }

  if (process.env.DISABLE_GOOGLE_SYNC === 'true') {
    return Response.json({ synced: false, reason: 'sync_disabled' });
  }

  if (request.nextUrl.searchParams.get('debug') === 'true') {
    const result = await debugGoogleSync();
    return Response.json(result);
  }

  const body = await request.json().catch(() => null);
  const colorIds = parseGoogleSyncColorIds(request.nextUrl.searchParams.get('colorIds'), body);
  if (colorIds.length === 0) {
    return Response.json({ synced: false, reason: 'no_color_selected' }, { status: 400 });
  }

  const force = request.nextUrl.searchParams.get('force') === 'true';

  if (!force) {
    const lastSynced = await getSyncMeta(LAST_SYNCED_KEY);
    if (lastSynced) {
      const elapsed = Date.now() - new Date(lastSynced).getTime();
      if (elapsed < SYNC_INTERVAL_MS) {
        return Response.json({ synced: false, reason: 'too_soon' });
      }
    }
  }

  try {
    const result = await syncGoogleToApp(colorIds);
    return Response.json(result);
  } catch {
    return Response.json({ synced: false, reason: 'error' }, { status: 500 });
  }
}
