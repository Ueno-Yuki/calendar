import type { NextRequest } from 'next/server';
import { getCurrentUser, AuthError } from '@/lib/auth';
import { parseGoogleReverseSelection, syncAppToGoogle } from '@/lib/googleCalendarSync';

function canUseMotherGoogleSync(role: ReturnType<typeof getCurrentUser>['role']): boolean {
  return role === 'mother' || role === 'me';
}

// POST /api/sync/google/reverse
// ユーザーが選択したアプリ予定だけを母Googleカレンダーへ作成・更新する。
export async function POST(request: NextRequest) {
  let currentUser: ReturnType<typeof getCurrentUser>;
  try {
    currentUser = getCurrentUser(request);
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ synced: false, reason: 'unauthorized' }, { status: 401 });
    }
    return Response.json({ synced: false, reason: 'error' }, { status: 500 });
  }

  if (!canUseMotherGoogleSync(currentUser.role)) {
    return Response.json({ synced: false, reason: 'forbidden' }, { status: 403 });
  }

  if (process.env.DISABLE_GOOGLE_SYNC === 'true') {
    return Response.json({ synced: false, reason: 'sync_disabled' });
  }

  const body = await request.json().catch(() => null);
  const selection = parseGoogleReverseSelection(body);
  if (selection.createIds.length === 0 && selection.updatePairs.length === 0) {
    return Response.json({ synced: false, reason: 'no_events_selected' }, { status: 400 });
  }

  try {
    const result = await syncAppToGoogle(selection);
    return Response.json(result);
  } catch {
    return Response.json({ synced: false, reason: 'error' }, { status: 500 });
  }
}
