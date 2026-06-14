import type { NextRequest } from 'next/server';
import { getCurrentUser, AuthError } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const user = getCurrentUser(request);
    return Response.json({ valid: true, role: user.role });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ valid: false }, { status: 401 });
    }
    return Response.json({ valid: false }, { status: 500 });
  }
}
