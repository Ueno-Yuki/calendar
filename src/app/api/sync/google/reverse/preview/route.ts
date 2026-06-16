import type { NextRequest } from 'next/server';
import { getCurrentUser, AuthError } from '@/lib/auth';
import { previewGoogleReverseSync } from '@/lib/googleCalendarSync';

function canUseMotherGoogleSync(role: ReturnType<typeof getCurrentUser>['role']): boolean {
  return role === 'mother' || role === 'me';
}

// GET /api/sync/google/reverse/preview
// アプリの母予定をGoogleへ反映する前に、新規登録候補・更新候補・スキップを返す。
export async function GET(request: NextRequest) {
  let currentUser: ReturnType<typeof getCurrentUser>;
  try {
    currentUser = getCurrentUser(request);
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
    }
    return Response.json({ ok: false, reason: 'error' }, { status: 500 });
  }

  if (!canUseMotherGoogleSync(currentUser.role)) {
    return Response.json({ ok: false, reason: 'forbidden' }, { status: 403 });
  }

  if (process.env.DISABLE_GOOGLE_SYNC === 'true') {
    return Response.json({ synced: false, reason: 'sync_disabled' });
  }

  try {
    const result = await previewGoogleReverseSync();
    return Response.json(result);
  } catch {
    return Response.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
