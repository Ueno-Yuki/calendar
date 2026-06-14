'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { FamilyRole } from '@/types';
import { STORAGE_KEY, type StoredUser } from '@/lib/auth';

interface Props {
  role: FamilyRole;
  token: string;
}

export default function AuthHandler({ role, token }: Props) {
  const router = useRouter();

  useEffect(() => {
    const user: StoredUser = { role, token };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    router.replace('/');
  }, [role, token, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-zinc-500">認証中...</p>
    </div>
  );
}
