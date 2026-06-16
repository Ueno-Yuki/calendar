import type { NextRequest } from 'next/server';
import { getCurrentUser, AuthError } from '@/lib/auth';
import { getSyncMeta } from '@/lib/syncMetaDb';
import { syncGoogleToApp } from '@/lib/googleCalendarSync';

const LAST_SYNCED_KEY = 'mother_google_calendar_last_synced_at';
const SYNC_INTERVAL_MS = 10 * 60 * 1000; // 10分

// POST /api/sync/google
// クライアントがバックグラウンドで呼ぶ Google → アプリ 同期エンドポイント。
// 最終同期から10分未満の場合は実行しない（?force=true で強制実行可）。
export async function POST(request: NextRequest) {
  try {
    getCurrentUser(request);
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: '認証が必要です' }, { status: 401 });
    }
    return Response.json({ error: 'サーバーエラー' }, { status: 500 });
  }

  if (process.env.DISABLE_GOOGLE_SYNC === 'true') {
    return Response.json({ synced: false, reason: 'sync_disabled' });
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

  // 表示月を受け取り同期範囲を限定する（繰り返し予定の大量取得防止）
  // 未指定の場合は JST 当月にフォールバック
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const yearParam = request.nextUrl.searchParams.get('year');
  const monthParam = request.nextUrl.searchParams.get('month');
  const displayYear = yearParam ? parseInt(yearParam, 10) : jstNow.getUTCFullYear();
  const displayMonth = monthParam ? parseInt(monthParam, 10) : jstNow.getUTCMonth() + 1;

  try {
    const result = await syncGoogleToApp(displayYear, displayMonth);
    return Response.json(result);
  } catch {
    return Response.json({ synced: false, reason: 'error' }, { status: 500 });
  }
}
