import type { NextRequest } from 'next/server';
import type { FamilyRole } from '@/types';

export const STORAGE_KEY = 'family_calendar_user';

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
 * クライアントは Authorization: Bearer <token> と X-Family-Role: <role> を送信する。
 * 検証失敗時は AuthError をスローする。
 */
export function getCurrentUser(request: NextRequest): { role: FamilyRole } {
  const authHeader = request.headers.get('authorization');
  const roleHeader = request.headers.get('x-family-role');

  if (!authHeader || !roleHeader) {
    throw new AuthError('Missing credentials');
  }

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) throw new AuthError('Invalid Authorization header');
  if (!isValidRole(roleHeader)) throw new AuthError('Invalid role');
  if (!validateToken(roleHeader, token)) throw new AuthError('Invalid token');

  return { role: roleHeader };
}
