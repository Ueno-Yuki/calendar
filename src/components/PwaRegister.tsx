'use client';

import { useEffect } from 'react';

// Service Worker を登録するクライアントコンポーネント。
// 登録失敗時にアプリを落とさず console.warn のみ出力する。
export default function PwaRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
      console.warn('[PWA] Service Worker registration failed:', err);
    });
  }, []);

  return null;
}
