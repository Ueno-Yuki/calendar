import type { NextRequest } from 'next/server';
import { getCurrentUser, AuthError } from '@/lib/auth';
import { deleteTemplate } from '@/lib/templatesDb';

// DELETE /api/event-suggestions/[id]
// 自分のテンプレート候補を論理削除する（deleted = TRUE）。
// 他人のテンプレートは 403 を返す。
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let currentUser: ReturnType<typeof getCurrentUser>;
  try {
    currentUser = getCurrentUser(request);
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: '認証が必要です' }, { status: 401 });
    }
    return Response.json({ error: 'サーバーエラー' }, { status: 500 });
  }

  const { id } = await params;

  try {
    const result = await deleteTemplate(id, currentUser.role);
    if (result === 'not_found') {
      return Response.json({ error: 'テンプレートが見つかりません' }, { status: 404 });
    }
    if (result === 'forbidden') {
      return Response.json({ error: '他人のテンプレートは削除できません' }, { status: 403 });
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: '削除に失敗しました' }, { status: 500 });
  }
}
