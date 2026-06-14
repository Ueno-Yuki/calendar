import type { NextRequest } from 'next/server';
import type { FamilyRole } from '@/types';

export const STORAGE_KEY = 'family_calendar_user';
export const COOKIE_NAME = 'family_calendar_user';

export const VALID_ROLES: FamilyRole[] = ['mother', 'father', 'me', 'brother'];

/** localStorage に保存されるユーザー情報の型 */
export interface StoredUser {
  role: FamilyRole;
  token: string;
}

const TOKEN_ENV_KEY: Record<FamilyRole, string> = {
  mother: 'FAMILY_TOKEN_MOTHER',
  father: 'FAMILY_TOKEN_FATHER',
  me: 'FAMILY_TOKEN_ME',
  brother: 'FAMILY_TOKEN_BROTHER',
};

export function isValidRole(value: string): value is FamilyRole {
  return VALID_ROLES.includes(value as FamilyRole);
}

/** role と token の組み合わせを環境変数と照合して検証する */
export function validateToken(role: FamilyRole, token: string): boolean {
  const expected = process.env[TOKEN_ENV_KEY[role]];
  return !!expected && expected === token;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * APIリクエストから現在のユーザーを識別する。
 * 1. Authorization: Bearer <token> + X-Family-Role: <role> ヘッダー
 * 2. Cookie family_calendar_user（PWAホーム画面からのアクセス時フォールバック）
 * 検証失敗時は AuthError をスローする。
 */
export function getCurrentUser(request: NextRequest): { role: FamilyRole } {
  // 1. ヘッダー認証
  const authHeader = request.headers.get('authorization');
  const roleHeader = request.headers.get('x-family-role');

  if (authHeader && roleHeader) {
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token && isValidRole(roleHeader) && validateToken(roleHeader, token)) {
      return { role: roleHeader };
    }
  }

  // 2. Cookie 認証
  const cookieRaw = request.cookies.get(COOKIE_NAME)?.value;
  if (cookieRaw) {
    const decoded = decodeURIComponent(cookieRaw);
    const idx = decoded.indexOf(':');
    if (idx > 0) {
      const role = decoded.slice(0, idx);
      const token = decoded.slice(idx + 1);
      if (isValidRole(role) && validateToken(role, token)) {
        return { role };
      }
    }
  }

  throw new AuthError('Missing credentials');
}
