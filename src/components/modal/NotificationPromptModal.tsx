'use client';

import { useState } from 'react';
import { Bell } from 'lucide-react';
import { subscribePush } from '@/lib/pushClient';
import { apiFetch } from '@/lib/apiClient';

export const NOTIFICATION_PROMPT_DISMISSED_KEY = 'notification_prompt_dismissed';

interface Props {
  onClose: () => void;
}

export default function NotificationPromptModal({ onClose }: Props) {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleDismiss = () => {
    localStorage.setItem(NOTIFICATION_PROMPT_DISMISSED_KEY, '1');
    onClose();
  };

  const handleAllow = async () => {
    setIsProcessing(true);
    try {
      // ユーザー操作（ボタンタップ）に紐づけて requestPermission を呼ぶ
      const result = await Notification.requestPermission();
      if (result === 'granted') {
        await subscribePush().catch(() => {});
        // 通知設定をONにする（デフォルト値だが明示的に保存する）
        apiFetch('/api/settings/notifications', {
          method: 'PUT',
          body: JSON.stringify({
            notification_enabled: true,
            daily_summary_enabled: true,
            instant_event_created_enabled: true,
            instant_event_deleted_enabled: true,
          }),
        }).catch(() => {});
      }
      // denied / default に関係なくモーダルを閉じる
      // denied の場合、設定モーダルに denied 用の案内が表示される
    } finally {
      setIsProcessing(false);
      onClose();
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-50" aria-hidden="true" />

      {/* Dialog */}
      <div className="fixed inset-0 z-[51] flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
          {/* Icon */}
          <div className="flex justify-center mb-4">
            <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center">
              <Bell size={28} className="text-blue-500" />
            </div>
          </div>

          {/* Title */}
          <h2 className="text-lg font-semibold text-zinc-900 text-center mb-2">
            通知を許可しますか？
          </h2>

          {/* Description */}
          <p className="text-sm text-zinc-500 text-center leading-relaxed mb-6">
            予定の追加・削除や今日の予定をお知らせします。
          </p>

          {/* Buttons */}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={isProcessing}
              onClick={handleAllow}
              className="w-full py-3 rounded-xl bg-blue-500 text-white font-semibold text-sm disabled:opacity-50"
            >
              {isProcessing ? '処理中…' : '通知を許可する'}
            </button>
            <button
              type="button"
              disabled={isProcessing}
              onClick={handleDismiss}
              className="w-full py-3 rounded-xl text-zinc-500 font-medium text-sm disabled:opacity-50"
            >
              あとで
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
