import { STORAGE_KEY, type StoredUser } from '@/lib/auth';

export class ApiAuthError extends Error {
  constructor(message = 'Not authenticated') {
    super(message);
    this.name = 'ApiAuthError';
  }
}

function getStoredUser(): StoredUser {
  if (typeof window === 'undefined') {
    throw new ApiAuthError('apiClient must be called in browser context');
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) throw new ApiAuthError('No user stored');
  try {
    return JSON.parse(raw) as StoredUser;
  } catch {
    throw new ApiAuthError('Corrupted user data in localStorage');
  }
}

/**
 * 認証ヘッダーを付与した fetch ラッパー。
 * PR03以降のクライアントからの全API呼び出しでこの関数を使用する。
 * localStorage に family_calendar_user が存在しない場合は ApiAuthError をスローする。
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const user = getStoredUser();
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${user.token}`);
  headers.set('X-Family-Role', user.role);
  if (init?.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(path, { ...init, headers });
}
