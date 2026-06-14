import type { NextRequest } from 'next/server';
import type { FamilyRole } from '@/types';
import { getCurrentUser, AuthError } from '@/lib/auth';
import { isValidRole } from '@/lib/auth';
import { getTemplateSuggestions } from '@/lib/templatesDb';

// GET /api/event-suggestions?person=me&title=病院

export async function GET(request: NextRequest) {
  try {
    getCurrentUser(request);
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: '認証が必要です' }, { status: 401 });
    }
    return Response.json({ error: 'サーバーエラー' }, { status: 500 });
  }

  const sp = request.nextUrl.searchParams;
  const titleQuery = sp.get('title') ?? '';
  const personParam = sp.get('person');
  const person: FamilyRole | null =
    personParam && isValidRole(personParam) ? personParam : null;

  try {
    const suggestions = await getTemplateSuggestions(titleQuery, person);
    return Response.json(suggestions);
  } catch {
    return Response.json({ error: '候補の取得に失敗しました' }, { status: 500 });
  }
}
