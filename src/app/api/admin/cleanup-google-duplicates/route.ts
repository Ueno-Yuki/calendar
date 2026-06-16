import type { NextRequest } from 'next/server';
import { cleanupGoogleDuplicates } from '@/lib/googleCalendarSync';

// POST /api/admin/cleanup-google-duplicates
// Google Calendar 同期による重複行を全月シートから検索・論理削除する。
// CRON_SECRET による認証必須。
// 使い方: curl -X POST https://your-domain/api/admin/cleanup-google-duplicates \
//            -H "Authorization: Bearer $CRON_SECRET"
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const secret = process.env.CRON_SECRET;

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await cleanupGoogleDuplicates();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cleanup-google-duplicates]', err);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
