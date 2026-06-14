import { notFound } from 'next/navigation';
import type { FamilyRole } from '@/types';
import { isValidRole, validateToken } from '@/lib/auth';
import AuthHandler from './AuthHandler';

export default async function FamilyPage({
  params,
  searchParams,
}: {
  params: Promise<{ role: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { role } = await params;
  const { token: tokenParam } = await searchParams;

  if (!isValidRole(role)) {
    notFound();
  }

  const familyRole = role as FamilyRole;
  const token = Array.isArray(tokenParam) ? tokenParam[0] : (tokenParam ?? '');

  if (!validateToken(familyRole, token)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
        <h1 className="text-xl font-semibold text-zinc-800">アクセスできません</h1>
        <p className="text-center text-zinc-500">
          URLが正しくないか、リンクの有効期限が切れています。
          <br />
          家族から共有されたURLをご確認ください。
        </p>
      </div>
    );
  }

  return <AuthHandler role={familyRole} token={token} />;
}
