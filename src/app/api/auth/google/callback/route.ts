import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { exchangeCodeForTokens } from '@/lib/googleCalendar';
import { setSyncMeta } from '@/lib/syncMetaDb';
import { importGoogleCalendar } from '@/lib/googleCalendarSync';

// GET /api/auth/google/callback
// Google OAuth認可コードを受け取り、Refresh Tokenに交換して sync_meta へ保存する。
// 初回取り込み未完了の場合は完了まで待ってから（セットアップ処理のため例外）トップへリダイレクト。
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const code = sp.get('code');
  const error = sp.get('error');

  if (error || !code) {
    return NextResponse.redirect(new URL('/?google_auth=error', request.url));
  }

  try {
    const redirectUri = new URL('/api/auth/google/callback', request.url).toString();
    const { refreshToken } = await exchangeCodeForTokens(code, redirectUri);

    await setSyncMeta('mother_google_refresh_token', refreshToken);

    // 初回取り込み（mother_google_import_completed != TRUE の場合のみ実行）
    await importGoogleCalendar();

    return NextResponse.redirect(new URL('/?google_auth=success', request.url));
  } catch {
    return NextResponse.redirect(new URL('/?google_auth=error', request.url));
  }
}
