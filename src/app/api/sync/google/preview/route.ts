import type { NextRequest } from 'next/server';
import { getCurrentUser, AuthError } from '@/lib/auth';
import { previewGoogleSync } from '@/lib/googleCalendarSync';

function canUseMotherGoogleSync(role: ReturnType<typeof getCurrentUser>['role']): boolean {
  return role === 'mother' || role === 'me';
}

// GET /api/sync/google/preview
// 母Googleカレンダーの同期対象候補を Event.colorId ごとに集計して返す。
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

  try {
    const result = await previewGoogleSync();
    return Response.json(result);
  } catch {
    return Response.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
