import type { NextRequest } from 'next/server';
import type { Event } from '@/types';
import { getCurrentUser, AuthError } from '@/lib/auth';
import { getRows, appendRowByHeaders, getMonthSheetName, ensureMonthSheet } from '@/lib/sheets';
import { parseEventRow, eventToRecord, isValidDeletedCell } from '@/lib/eventsDb';
import { upsertTemplate } from '@/lib/templatesDb';
import { setSyncMeta } from '@/lib/syncMetaDb';
import { sendInstantNotification } from '@/lib/notificationService';

// ---- 日付ユーティリティ ----

function getLastDayOfMonth(year: number, month: number): string {
  const d = new Date(year, month, 0);
  return `${year}-${String(month).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getPrevMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

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

// ---- GET /api/events?year=YYYY&month=MM ----
// Sheetsの予定を即返す。Google同期は実行しない。

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
  const year = parseInt(sp.get('year') ?? '');
  const month = parseInt(sp.get('month') ?? '');

  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
    return Response.json({ error: 'year・month パラメータが不正です' }, { status: 400 });
  }

  try {
    const currentSheetName = getMonthSheetName(year, month);
    const prev = getPrevMonth(year, month);
    const prevSheetName = getMonthSheetName(prev.year, prev.month);

    const [currentRows, prevRows] = await Promise.all([
      getRows(currentSheetName),
      getRows(prevSheetName),
    ]);

    const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = getLastDayOfMonth(year, month);

    const rows = [...prevRows, ...currentRows];
    rows.forEach((row) => {
      if (!isValidDeletedCell(row.deleted)) {
        console.error('[events:get] invalid deleted cell', {
          id: row.id ?? '',
          title: row.title ?? '',
          start_date: row.start_date ?? '',
          deleted: row.deleted ?? '',
        });
      }
    });

    const events: Event[] = rows
      .filter((r) => r.deleted !== 'TRUE')
      .filter((r) => r.start_date <= lastDay && r.end_date >= firstDay)
      .map(parseEventRow);

    return Response.json({ events });
  } catch (error) {
    console.error('[events:get] failed to read sheets', {
      year,
      month,
      errorMessage: error instanceof Error ? error.message : 'unknown error',
    });
    return Response.json({ error: 'データ取得に失敗しました' }, { status: 500 });
  }
}

// ---- POST /api/events ----
// Google Calendar への反映はヘッダーの手動逆同期で行う。

export async function POST(request: NextRequest) {
  let currentUser: ReturnType<typeof getCurrentUser>;
  try {
    currentUser = getCurrentUser(request);
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: '認証が必要です' }, { status: 401 });
    }
    return Response.json({ error: 'サーバーエラー' }, { status: 500 });
  }

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
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    const event: Event = {
      id,
      owner: currentUser.role,
      person: currentUser.role,
      title: input.title,
      start_date: input.start_date,
      end_date: input.end_date,
      start_time: input.start_time,
      end_time: input.end_time,
      location: input.location,
      memo: input.memo,
      all_day: input.all_day,
      source: 'manual',
      google_event_id: '',
      google_color_id: '',
      created_at: now,
      updated_at: now,
      deleted: false,
    };

    const [startYearStr, startMonthStr] = input.start_date.split('-');
    const startYear = parseInt(startYearStr);
    const startMonth = parseInt(startMonthStr);
    await ensureMonthSheet(startYear, startMonth);
    await appendRowByHeaders(getMonthSheetName(startYear, startMonth), eventToRecord(event));

    setSyncMeta('events_last_updated_at', new Date().toISOString()).catch(() => {});

    upsertTemplate({
      person: event.person,
      title: event.title,
      start_time: event.start_time,
      end_time: event.end_time,
      location: event.location,
      memo: event.memo,
    }).catch(() => {});

    // 本人以外の家族へ即時Push通知（失敗しても登録成功扱い）
    sendInstantNotification('event_created', event, currentUser.role).catch(() => {});

    return Response.json(event, { status: 201 });
  } catch {
    return Response.json({ error: '予定の登録に失敗しました' }, { status: 500 });
  }
}
