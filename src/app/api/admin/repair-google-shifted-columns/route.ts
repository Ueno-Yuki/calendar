import type { NextRequest } from 'next/server';
import { repairGoogleShiftedEventColumns } from '@/lib/googleCalendarSync';

// POST /api/admin/repair-google-shifted-columns
// 旧Google同期実装で created_at / updated_at / deleted / google_color_id が
// ずれて保存された source=google 行を補正する。
// CRON_SECRET による認証必須。
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const secret = process.env.CRON_SECRET;

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await repairGoogleShiftedEventColumns();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error('[repair-google-shifted-columns]', err);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
