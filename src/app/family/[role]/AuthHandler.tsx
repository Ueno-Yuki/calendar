'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { FamilyRole } from '@/types';
import { STORAGE_KEY, COOKIE_NAME, type StoredUser } from '@/lib/auth';
import { apiFetch } from '@/lib/apiClient';

interface Props {
  role: FamilyRole;
  token: string;
}

function writeAuthCookie(role: string, token: string): void {
  const value = encodeURIComponent(`${role}:${token}`);
  const maxAge = 365 * 24 * 60 * 60; // 1 年
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE_NAME}=${value}; path=/; max-age=${maxAge}; SameSite=Strict${secure}`;
}

export default function AuthHandler({ role, token }: Props) {
  const router = useRouter();

  useEffect(() => {
    const user: StoredUser = { role, token };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    writeAuthCookie(role, token);

    if (role !== 'mother') {
      router.replace('/');
      return;
    }

    // mother のみ: Google 連携済みか確認し、未連携なら OAuth へ誘導する
    apiFetch('/api/auth/google/status')
      .then((res) => (res.ok ? (res.json() as Promise<{ connected: boolean }>) : null))
      .then((data) => {
        if (data?.connected) {
          router.replace('/');
        } else {
          // Cookie が付いた状態で /api/auth/google へ遷移する
          window.location.href = '/api/auth/google';
        }
      })
      .catch(() => {
        // 確認失敗時はトップへ（Google 連携なしで通常利用）
        router.replace('/');
      });
  }, [role, token, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-zinc-500">認証中...</p>
    </div>
  );
}
