import { getRows, appendRow, updateRow, ensureSheet } from '@/lib/sheets';

const SHEET = 'push_subscriptions';
const HEADERS = [
  'user_id', 'endpoint', 'p256dh', 'auth',
  'enabled', 'created_at', 'updated_at',
] as const;

async function ensurePushSubscriptionsSheet(): Promise<void> {
  await ensureSheet(SHEET, HEADERS);
}

/**
 * Push Subscription を保存する。
 * 同じ endpoint が既に存在する場合は更新（enabled = TRUE）。
 */
export async function savePushSubscription(
  userId: string,
  endpoint: string,
  p256dh: string,
  auth: string,
): Promise<void> {
  await ensurePushSubscriptionsSheet();
  const rows = await getRows(SHEET);
  const idx = rows.findIndex((r) => r.endpoint === endpoint);
  const now = new Date().toISOString();

  if (idx === -1) {
    await appendRow(SHEET, [userId, endpoint, p256dh, auth, 'TRUE', now, now]);
  } else {
    const existing = rows[idx];
    await updateRow(SHEET, idx, [
      userId,
      endpoint,
      p256dh,
      auth,
      'TRUE',
      existing.created_at || now,
      now,
    ]);
  }
}

/**
 * 該当 endpoint の enabled を FALSE に更新する。
 * 存在しない場合は何もしない。
 */
export async function disablePushSubscription(endpoint: string): Promise<void> {
  await ensurePushSubscriptionsSheet();
  const rows = await getRows(SHEET);
  const idx = rows.findIndex((r) => r.endpoint === endpoint);
  if (idx === -1) return;

  const row = rows[idx];
  const now = new Date().toISOString();
  await updateRow(SHEET, idx, [
    row.user_id,
    row.endpoint,
    row.p256dh,
    row.auth,
    'FALSE',
    row.created_at,
    now,
  ]);
}

/**
 * 有効な Push Subscription を全件取得する（PR12 以降でPush送信時に使用）。
 */
export async function getEnabledSubscriptions(): Promise<
  { userId: string; endpoint: string; p256dh: string; auth: string }[]
> {
  await ensurePushSubscriptionsSheet();
  const rows = await getRows(SHEET);
  return rows
    .filter((r) => r.enabled === 'TRUE' && r.endpoint)
    .map((r) => ({
      userId: r.user_id,
      endpoint: r.endpoint,
      p256dh: r.p256dh,
      auth: r.auth,
    }));
}
