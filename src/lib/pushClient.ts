// Push Subscription ユーティリティ（クライアント側）
// serviceWorker API を使うため、useEffect などクライアント文脈からのみ呼ぶこと。

import { apiFetch } from '@/lib/apiClient';

// VAPID public key を Uint8Array に変換（PushManager.subscribe に必要）
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) {
    view[i] = rawData.charCodeAt(i);
  }
  return view;
}

/**
 * Push通知を購読してサーバーへ保存する。
 * - 購読許可がまだの場合はブラウザの許可ダイアログを表示する
 * - NEXT_PUBLIC_VAPID_PUBLIC_KEY 環境変数が必要
 * @returns 購読成功なら true
 */
export async function subscribePush(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) {
    console.warn('[PWA] NEXT_PUBLIC_VAPID_PUBLIC_KEY が設定されていません');
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });

    const json = subscription.toJSON();
    const res = await apiFetch('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: json.keys,
      }),
    });

    return res.ok;
  } catch (err) {
    console.warn('[PWA] Push subscription failed:', err);
    return false;
  }
}

/**
 * Push通知の購読を解除してサーバーへ通知する。
 * @returns 解除成功なら true
 */
export async function unsubscribePush(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return true;

    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();

    const res = await apiFetch('/api/push/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint }),
    });

    return res.ok;
  } catch (err) {
    console.warn('[PWA] Push unsubscription failed:', err);
    return false;
  }
}

/**
 * 現在の Push 通知許可状態を返す。
 */
export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}
