'use client';

import { STORAGE_KEY, COOKIE_NAME, isValidRole, type StoredUser } from '@/lib/auth';

export class ApiAuthError extends Error {
  constructor(message = 'Not authenticated') {
    super(message);
    this.name = 'ApiAuthError';
  }
}

function readFromCookie(): StoredUser | null {
  if (typeof document === 'undefined') return null;
  const entry = document.cookie.split('; ').find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!entry) return null;
  const raw = entry.slice(COOKIE_NAME.length + 1);
  const decoded = decodeURIComponent(raw);
  const idx = decoded.indexOf(':');
  if (idx < 0) return null;
  const role = decoded.slice(0, idx);
  const token = decoded.slice(idx + 1);
  if (!isValidRole(role)) return null;
  return { role, token };
}

function writeAuthCookie(role: string, token: string): void {
  if (typeof document === 'undefined') return;
  const value = encodeURIComponent(`${role}:${token}`);
  const maxAge = 365 * 24 * 60 * 60;
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE_NAME}=${value}; path=/; max-age=${maxAge}; SameSite=Strict${secure}`;
}

function getStoredUser(): StoredUser {
  if (typeof window === 'undefined') {
    throw new ApiAuthError('apiClient must be called in browser context');
  }

  // 1. localStorage
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const user = JSON.parse(raw) as StoredUser;
      // Cookie がない場合（旧クライアント or Cookieが期限切れ）は同期する
      if (!readFromCookie()) {
        writeAuthCookie(user.role, user.token);
      }
      return user;
    } catch {
      // 破損データは無視して Cookie にフォールバック
    }
  }

  // 2. Cookie（PWAホーム画面からのアクセス時など localStorage が空の場合）
  const cookieUser = readFromCookie();
  if (cookieUser) {
    // 以降のリクエストで再利用できるよう localStorage に同期する
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cookieUser));
    return cookieUser;
  }

  throw new ApiAuthError('No user stored');
}

/**
 * 認証ヘッダーを付与した fetch ラッパー。
 * localStorage → Cookie の順で認証情報を取得する。
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
