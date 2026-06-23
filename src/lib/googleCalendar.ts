import { google } from 'googleapis';
import type { calendar_v3 } from 'googleapis';
import type { Event } from '@/types';
import { getSyncMeta, setSyncMeta } from '@/lib/syncMetaDb';

const REFRESH_TOKEN_KEY = 'mother_google_refresh_token';
const AUTH_STATUS_KEY = 'mother_google_auth_status';
const REAUTH_REQUIRED_STATUS = 'reauth_required';
const CALENDAR_ID = () => process.env.GOOGLE_CALENDAR_ID_MOTHER ?? 'primary';

export function getOAuth2Client(redirectUri?: string) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri,
  );
}

export function getAuthUrl(redirectUri: string): string {
  const client = getOAuth2Client(redirectUri);
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar'],
  });
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string }> {
  const client = getOAuth2Client(redirectUri);
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) throw new Error('Refresh token not returned');
  return { refreshToken: tokens.refresh_token };
}

function getGoogleAuthErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const maybeError = error as {
    message?: string;
    response?: { data?: { error?: string; error_description?: string } };
  };
  return [
    maybeError.response?.data?.error,
    maybeError.response?.data?.error_description,
    maybeError.message,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase();
}

function isInvalidGrantError(error: unknown): boolean {
  const message = getGoogleAuthErrorMessage(error);
  return (
    message.includes('invalid_grant') ||
    message.includes('token has been expired or revoked') ||
    message.includes('expired or revoked')
  );
}

export async function markGoogleReauthRequired(): Promise<void> {
  await setSyncMeta(AUTH_STATUS_KEY, REAUTH_REQUIRED_STATUS);
}

export async function clearGoogleReauthRequired(): Promise<void> {
  await setSyncMeta(AUTH_STATUS_KEY, '');
}

export function getStoredGoogleRefreshToken(syncMeta?: Map<string, string>): string | null {
  const value = syncMeta?.get(REFRESH_TOKEN_KEY) ?? null;
  return value && value.trim() ? value.trim() : null;
}

export async function getGoogleAccessToken(refreshToken: string): Promise<string> {
  const client = getOAuth2Client();
  client.setCredentials({ refresh_token: refreshToken });
  try {
    const result = await client.getAccessToken();
    const accessToken =
      typeof result === 'object' && result !== null && 'token' in result
        ? result.token
        : null;
    if (!accessToken) {
      throw new Error('Google access token not returned');
    }
    return accessToken;
  } catch (error) {
    if (isInvalidGrantError(error)) {
      await markGoogleReauthRequired().catch(() => {});
    }
    throw error;
  }
}

export async function getAuthorizedCalendar(options?: {
  refreshToken?: string | null;
  syncMeta?: Map<string, string>;
}): Promise<calendar_v3.Calendar | null> {
  const refreshToken = options?.refreshToken ?? getStoredGoogleRefreshToken(options?.syncMeta) ?? await getSyncMeta(REFRESH_TOKEN_KEY);
  if (!refreshToken) return null;

  const accessToken = await getGoogleAccessToken(refreshToken);
  const client = getOAuth2Client();
  client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  return google.calendar({ version: 'v3', auth: client });
}

// ---- 日時パース ----

function parseGCalDT(dt: calendar_v3.Schema$EventDateTime): {
  date: string;
  time: string;
  allDay: boolean;
} {
  if (dt.date) {
    return { date: dt.date, time: '', allDay: true };
  }
  if (dt.dateTime) {
    const d = new Date(dt.dateTime);
    // UTC → JST (+9h)
    const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    const date = jst.toISOString().slice(0, 10);
    const time = jst.toISOString().slice(11, 16);
    return { date, time, allDay: false };
  }
  throw new Error('Invalid datetime');
}

// Google Calendar の終日予定 end.date は翌日なので -1 日する
function subtractOneDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export interface ParsedGCalEvent {
  google_event_id: string;
  title: string;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  all_day: boolean;
  location: string;
  memo: string;
}

export function parseGCalEvent(
  item: calendar_v3.Schema$Event,
): ParsedGCalEvent | null {
  if (!item.id || !item.start || !item.end) return null;
  if (item.status === 'cancelled') return null;

  try {
    const start = parseGCalDT(item.start);
    const endRaw = parseGCalDT(item.end);
    const end_date = start.allDay && endRaw.allDay
      ? subtractOneDay(endRaw.date)
      : endRaw.date;

    return {
      google_event_id: item.id,
      title: item.summary ?? '(タイトルなし)',
      start_date: start.date,
      end_date,
      start_time: start.time,
      end_time: endRaw.time,
      all_day: start.allDay,
      location: item.location ?? '',
      memo: item.description ?? '',
    };
  } catch {
    return null;
  }
}

// ---- Event → Google Calendar 変換 ----

function addOneHour(time: string): string {
  const [h, m] = time.split(':').map(Number);
  return `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function toGCalBody(event: Event, colorId?: string): calendar_v3.Schema$Event {
  const body: calendar_v3.Schema$Event = {
    summary: event.title,
    location: event.location || undefined,
    description: event.memo || undefined,
    colorId: colorId && colorId !== 'default' ? colorId : undefined,
  };

  if (event.all_day) {
    const d = new Date(`${event.end_date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    body.start = { date: event.start_date };
    body.end = { date: d.toISOString().slice(0, 10) };
  } else {
    const tz = 'Asia/Tokyo';
    const endTime = event.end_time || addOneHour(event.start_time);
    body.start = { dateTime: `${event.start_date}T${event.start_time}:00`, timeZone: tz };
    body.end = { dateTime: `${event.end_date}T${endTime}:00`, timeZone: tz };
  }

  return body;
}

export async function createGCalEvent(event: Event, colorId?: string): Promise<string | null> {
  const calendar = await getAuthorizedCalendar();
  if (!calendar) return null;
  const res = await calendar.events.insert({
    calendarId: CALENDAR_ID(),
    requestBody: toGCalBody(event, colorId),
  });
  return res.data.id ?? null;
}

export async function updateGCalEvent(googleEventId: string, event: Event, colorId?: string): Promise<void> {
  const calendar = await getAuthorizedCalendar();
  if (!calendar || !googleEventId) return;
  await calendar.events.update({
    calendarId: CALENDAR_ID(),
    eventId: googleEventId,
    requestBody: toGCalBody(event, colorId),
  });
}

export async function deleteGCalEvent(googleEventId: string): Promise<void> {
  const calendar = await getAuthorizedCalendar();
  if (!calendar || !googleEventId) return;
  try {
    await calendar.events.delete({
      calendarId: CALENDAR_ID(),
      eventId: googleEventId,
    });
  } catch {
    // 既に削除済みなどは無視
  }
}
