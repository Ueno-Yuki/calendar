import type { NextRequest } from 'next/server';
import { getCurrentUser, AuthError } from '@/lib/auth';
import { debugGoogleSync, parseGoogleSyncSelection, syncGoogleToApp } from '@/lib/googleCalendarSync';

function canUseMotherGoogleSync(role: ReturnType<typeof getCurrentUser>['role']): boolean {
  return role === 'mother' || role === 'me';
}

// POST /api/sync/google
// Google → アプリ の手動同期エンドポイント。
// 取得範囲は syncGoogleToApp() 内で現在日時から当年末まで (JST)。
// プレビューで選択したイベントのみを都度取り込む、明示的なユーザー操作。
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
  const selection = parseGoogleSyncSelection(request.nextUrl.searchParams.get('colorIds'), body);
  if ((selection.eventIds?.length ?? selection.colorIds?.length ?? 0) === 0) {
    return Response.json({ synced: false, reason: 'no_events_selected' }, { status: 400 });
  }

  try {
    const result = await syncGoogleToApp(selection);
    return Response.json(result);
  } catch {
    return Response.json({ synced: false, reason: 'error' }, { status: 500 });
  }
}
