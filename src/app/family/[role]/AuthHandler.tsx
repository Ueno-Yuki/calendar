'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { FamilyRole } from '@/types';
import { STORAGE_KEY, COOKIE_NAME, type StoredUser } from '@/lib/auth';

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
    router.replace('/');
  }, [role, token, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-zinc-500">認証中...</p>
    </div>
  );
}
