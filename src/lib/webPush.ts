import webPush from 'web-push';

let initialized = false;

function ensureVapidInitialized(): void {
  if (initialized) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    throw new Error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set');
  }
  webPush.setVapidDetails('mailto:noreply@family-calendar.app', publicKey, privateKey);
  initialized = true;
}

/**
 * 単一のPush Subscriptionへ通知を送信する。
 * payload は JSON.stringify() 済みの文字列を渡すこと。
 * 410 Gone など無効なEndpointの場合は例外を throw する (呼び出し側でdisable処理する)。
 */
export async function sendPushToSubscription(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: string,
): Promise<void> {
  ensureVapidInitialized();
  await webPush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    },
    payload,
    { TTL: 3600 },
  );
}
