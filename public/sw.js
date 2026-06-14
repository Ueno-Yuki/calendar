// Family Calendar Service Worker
// PR10: PWA基盤。Push通知受信・notificationclick 対応。

const CACHE_NAME = 'family-calendar-v1';

self.addEventListener('install', () => {
  // 旧バージョンを即座に置き換える
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // 旧キャッシュを削除して即座に制御を取得
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      ),
      self.clients.claim(),
    ]),
  );
});

// Push通知受信
// payload形式: { "title": "...", "body": "...", "url": "/" }
self.addEventListener('push', (event) => {
  let data = { title: '家族カレンダー', body: '通知があります', url: '/' };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      data.body = event.data.text() || data.body;
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon.svg',
      badge: '/icons/icon.svg',
      data: { url: data.url ?? '/' },
      requireInteraction: false,
    }),
  );
});

// 通知タップ
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // 既に開いているウィンドウがあればフォーカス
        for (const client of clientList) {
          if ('focus' in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        // なければ新しいウィンドウで開く
        if (clients.openWindow) return clients.openWindow(url);
      }),
  );
});
