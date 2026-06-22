import type { NextRequest } from 'next/server';
import type { Event, EventMutationResult } from '@/types';
import { getCurrentUser, AuthError } from '@/lib/auth';
import { updateRowByHeaders, appendRowByHeaders, getMonthSheetName, ensureMonthSheet } from '@/lib/sheets';
import { findEventById, eventToRecord } from '@/lib/eventsDb';
import { sendInstantNotification } from '@/lib/notificationService';
import { setSyncMeta } from '@/lib/syncMetaDb';

// ---- バリデーション ----

interface EventInput {
  title: string;
  start_date: string;
  end_date: string;
  all_day: boolean;
  start_time: string;
  end_time: string;
  location: string;
  memo: string;
}

function validateEventBody(
  body: unknown,
): { ok: true; data: EventInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'リクエストボディが不正です' };
  }
  const b = body as Record<string, unknown>;

  if (typeof b.title !== 'string' || !b.title.trim()) {
    return { ok: false, error: 'title は必須です' };
  }
  if (typeof b.start_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.start_date)) {
    return { ok: false, error: 'start_date は YYYY-MM-DD 形式で必須です' };
  }
  if (typeof b.end_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.end_date)) {
    return { ok: false, error: 'end_date は YYYY-MM-DD 形式で必須です' };
  }
  if (b.end_date < b.start_date) {
    return { ok: false, error: 'end_date は start_date 以降でなければなりません' };
  }

  const all_day = Boolean(b.all_day);
  if (!all_day) {
    if (typeof b.start_time !== 'string' || !/^\d{2}:\d{2}$/.test(b.start_time)) {
      return { ok: false, error: '終日でない場合、start_time (HH:MM) は必須です' };
    }
    if (
      b.end_time !== undefined &&
      b.end_time !== '' &&
      (typeof b.end_time !== 'string' || !/^\d{2}:\d{2}$/.test(b.end_time))
    ) {
      return { ok: false, error: 'end_time は HH:MM 形式で入力してください' };
    }
  }

  return {
    ok: true,
    data: {
      title: (b.title as string).trim(),
      start_date: b.start_date as string,
      end_date: b.end_date as string,
      all_day,
      start_time: all_day ? '' : ((b.start_time as string | undefined) ?? ''),
      end_time: all_day ? '' : ((b.end_time as string | undefined) ?? ''),
      location: typeof b.location === 'string' ? b.location : '',
      memo: typeof b.memo === 'string' ? b.memo : '',
    },
  };
}

// ---- PUT /api/events/[id]?year=YYYY&month=MM ----
// Google Calendar への反映はヘッダーの手動逆同期で行う。

export async function PUT(
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

  const sp = request.nextUrl.searchParams;
  const hintYear = parseInt(sp.get('year') ?? '') || undefined;
  const hintMonth = parseInt(sp.get('month') ?? '') || undefined;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'リクエストボディのパースに失敗しました' }, { status: 400 });
  }

  const validation = validateEventBody(body);
  if (!validation.ok) {
    return Response.json({ error: validation.error }, { status: 400 });
  }
  const input = validation.data;

  try {
    const found = await findEventById(id, hintYear, hintMonth);
    if (!found || found.event.deleted) {
      return Response.json({ error: '予定が見つかりません' }, { status: 404 });
    }

    if (found.event.owner !== currentUser.role) {
      return Response.json({ error: '他人の予定は編集できません' }, { status: 403 });
    }

    const eventsLastUpdatedAt = new Date().toISOString();
    const updated: Event = {
      ...found.event,
      title: input.title,
      start_date: input.start_date,
      end_date: input.end_date,
      all_day: input.all_day,
      start_time: input.start_time,
      end_time: input.end_time,
      location: input.location,
      memo: input.memo,
      updated_at: eventsLastUpdatedAt,
    };

    const oldMonthKey = found.event.start_date.slice(0, 7); // YYYY-MM
    const newMonthKey = input.start_date.slice(0, 7);

    if (oldMonthKey !== newMonthKey) {
      // start_date の月が変わった場合:
      // 旧シートの行を論理削除し、新シートへ同じ id で新規追加する
      const deletedOld: Event = {
        ...found.event,
        deleted: true,
        updated_at: updated.updated_at,
      };
      await updateRowByHeaders(found.sheetName, found.dataRowIndex, eventToRecord(deletedOld));

      const [newYStr, newMStr] = input.start_date.split('-');
      await ensureMonthSheet(parseInt(newYStr), parseInt(newMStr));
      await appendRowByHeaders(getMonthSheetName(parseInt(newYStr), parseInt(newMStr)), eventToRecord(updated));
    } else {
      await updateRowByHeaders(found.sheetName, found.dataRowIndex, eventToRecord(updated));
    }

    await setSyncMeta('events_last_updated_at', eventsLastUpdatedAt);

    const result: EventMutationResult = { event: updated, eventsLastUpdatedAt };
    return Response.json(result);
  } catch {
    return Response.json({ error: '予定の更新に失敗しました' }, { status: 500 });
  }
}

// ---- DELETE /api/events/[id]?year=YYYY&month=MM ----
// Sheets 側は論理削除（deleted = TRUE）。Google Calendar への削除反映は行わない。

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

  const sp = request.nextUrl.searchParams;
  const hintYear = parseInt(sp.get('year') ?? '') || undefined;
  const hintMonth = parseInt(sp.get('month') ?? '') || undefined;

  try {
    const found = await findEventById(id, hintYear, hintMonth);
    if (!found || found.event.deleted) {
      return Response.json({ error: '予定が見つかりません' }, { status: 404 });
    }

    if (found.event.owner !== currentUser.role) {
      return Response.json({ error: '他人の予定は削除できません' }, { status: 403 });
    }

    const eventsLastUpdatedAt = new Date().toISOString();
    const deleted: Event = {
      ...found.event,
      deleted: true,
      updated_at: eventsLastUpdatedAt,
    };

    await updateRowByHeaders(found.sheetName, found.dataRowIndex, eventToRecord(deleted));

    await setSyncMeta('events_last_updated_at', eventsLastUpdatedAt);

    // 本人以外の家族へ即時Push通知（失敗しても削除成功扱い）
    sendInstantNotification('event_deleted', deleted, currentUser.role).catch(() => {});

    const result: EventMutationResult = { event: deleted, eventsLastUpdatedAt };
    return Response.json(result);
  } catch {
    return Response.json({ error: '予定の削除に失敗しました' }, { status: 500 });
  }
}
