import type { NextRequest } from 'next/server';
import { runDailySummary } from '@/lib/dailySummary';

// GET /api/cron/daily-summary
// Vercel Cron から毎日 UTC 21:00（JST 06:00）に呼ばれ、今日の予定サマリーを送信する。
//
// 認証:
//   Authorization: Bearer <CRON_SECRET>  ← Vercel Cron が自動付与
//   ?secret=<CRON_SECRET>                ← 手動テスト用
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;

  const authHeader = request.headers.get('authorization');
  const secretParam = request.nextUrl.searchParams.get('secret');

  const isAuthorized =
    !!cronSecret &&
    (authHeader === `Bearer ${cronSecret}` || secretParam === cronSecret);

  if (!isAuthorized) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await runDailySummary();
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
