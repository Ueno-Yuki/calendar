import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthUrl } from '@/lib/googleCalendar';

// GET /api/auth/google
// 母のGoogle OAuth同意画面へリダイレクトする。
// スコープ: calendar（読み書き）、access_type: offline でRefresh Tokenを取得する。
export async function GET(request: NextRequest) {
  const redirectUri = new URL('/api/auth/google/callback', request.url).toString();
  const authUrl = getAuthUrl(redirectUri);
  return NextResponse.redirect(authUrl);
}
