'use client';

import { useState, useEffect } from 'react';
import { X, Bell, BellOff } from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';
import { STORAGE_KEY } from '@/lib/auth';
import type { StoredUser } from '@/lib/auth';
import { FAMILY_COLORS } from '@/lib/colors';
import type { FamilyRole } from '@/types';
import { subscribePush, getNotificationPermission } from '@/lib/pushClient';

interface NotificationSettings {
  notification_enabled: boolean;
  daily_summary_enabled: boolean;
  instant_event_created_enabled: boolean;
  instant_event_deleted_enabled: boolean;
}

const DEFAULT_SETTINGS: NotificationSettings = {
  notification_enabled: true,
  daily_summary_enabled: true,
  instant_event_created_enabled: true,
  instant_event_deleted_enabled: true,
};

function readCurrentRole(): FamilyRole | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return (JSON.parse(raw) as StoredUser).role;
  } catch {
    return null;
  }
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-blue-500' : 'bg-zinc-200'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

interface Props {
  onClose: () => void;
}

export default function SettingsModal({ onClose }: Props) {
  const [role, setRole] = useState<FamilyRole | null>(null);
  const [settings, setSettings] = useState<NotificationSettings>(DEFAULT_SETTINGS);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [isSubscribing, setIsSubscribing] = useState(false);

  useEffect(() => {
    const r = readCurrentRole();
    setRole(r);
    setPermission(getNotificationPermission());

    if (!r) return;
    apiFetch('/api/settings/notifications')
      .then((res) => (res.ok ? (res.json() as Promise<NotificationSettings>) : null))
      .then((data) => {
        if (data) setSettings(data);
      })
      .catch(() => {});
  }, []);

  const saveSettings = (next: NotificationSettings) => {
    setSettings(next);
    apiFetch('/api/settings/notifications', {
      method: 'PUT',
      body: JSON.stringify(next),
    }).catch(() => {});
  };

  const handleToggle = (key: keyof NotificationSettings) => {
    saveSettings({ ...settings, [key]: !settings[key] });
  };

  const handleRequestPermission = async () => {
    setIsSubscribing(true);
    try {
      await subscribePush();
    } finally {
      setPermission(getNotificationPermission());
      setIsSubscribing(false);
    }
  };

  const roleColor = role ? FAMILY_COLORS[role].main : '#94a3b8';
  const roleLabel = role ? FAMILY_COLORS[role].label : '—';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl flex flex-col"
        style={{
          maxHeight: '85dvh',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 shrink-0 border-b border-zinc-100">
          <h2 className="text-base font-semibold text-zinc-900">設定</h2>
          <button
            type="button"
            aria-label="閉じる"
            onClick={onClose}
            className="p-1 text-zinc-400 hover:text-zinc-600"
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">

          {/* この端末の利用者 */}
          <section className="px-4 pt-5 pb-4">
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-3">
              この端末の利用者
            </p>
            <div className="flex items-center gap-3">
              <span
                className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
                style={{ backgroundColor: roleColor }}
              >
                {roleLabel}
              </span>
              <span className="text-sm font-medium text-zinc-800">{roleLabel}</span>
            </div>
          </section>

          <div className="h-px bg-zinc-100 mx-4" />

          {/* Push通知許可 */}
          <section className="px-4 pt-5 pb-4">
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-3">
              Push通知
            </p>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {permission === 'granted' ? (
                  <Bell size={16} className="text-green-500" />
                ) : (
                  <BellOff size={16} className="text-zinc-400" />
                )}
                <span className="text-sm text-zinc-700">
                  {permission === 'granted' && '許可済み'}
                  {permission === 'default' && '未許可'}
                  {permission === 'denied' && 'ブロック中'}
                  {permission === 'unsupported' && '非対応ブラウザ'}
                </span>
              </div>

              {permission === 'default' && (
                <button
                  type="button"
                  disabled={isSubscribing}
                  onClick={handleRequestPermission}
                  className="text-xs px-3 py-1.5 rounded-full bg-blue-500 text-white font-medium disabled:opacity-50"
                >
                  {isSubscribing ? '処理中…' : '通知を許可する'}
                </button>
              )}
            </div>

            {permission === 'denied' && (
              <p className="mt-2 text-xs text-zinc-400">
                ブラウザの設定から通知の許可を変更してください。
              </p>
            )}
          </section>

          <div className="h-px bg-zinc-100 mx-4" />

          {/* 通知設定トグル */}
          <section className="px-4 pt-5 pb-8">
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-3">
              通知設定
            </p>

            <div className="rounded-xl border border-zinc-100 overflow-hidden bg-zinc-50">

              {/* マスタースイッチ */}
              <div className="flex items-center justify-between px-4 py-3.5 bg-white">
                <span className="text-sm font-medium text-zinc-800">通知を受け取る</span>
                <Toggle
                  checked={settings.notification_enabled}
                  onChange={() => handleToggle('notification_enabled')}
                />
              </div>

              <div className="h-px bg-zinc-100" />

              {/* 今日の予定通知 */}
              <div className="flex items-center justify-between px-4 py-3.5">
                <div>
                  <p className={`text-sm ${settings.notification_enabled ? 'text-zinc-700' : 'text-zinc-400'}`}>
                    今日の予定通知
                  </p>
                  <p className="text-xs text-zinc-400 mt-0.5">毎朝8時にお知らせ</p>
                </div>
                <Toggle
                  checked={settings.daily_summary_enabled}
                  onChange={() => handleToggle('daily_summary_enabled')}
                  disabled={!settings.notification_enabled}
                />
              </div>

              <div className="h-px bg-zinc-100" />

              {/* 予定追加通知 */}
              <div className="flex items-center justify-between px-4 py-3.5">
                <div>
                  <p className={`text-sm ${settings.notification_enabled ? 'text-zinc-700' : 'text-zinc-400'}`}>
                    予定追加通知
                  </p>
                  <p className="text-xs text-zinc-400 mt-0.5">家族が予定を追加したとき</p>
                </div>
                <Toggle
                  checked={settings.instant_event_created_enabled}
                  onChange={() => handleToggle('instant_event_created_enabled')}
                  disabled={!settings.notification_enabled}
                />
              </div>

              <div className="h-px bg-zinc-100" />

              {/* 予定削除通知 */}
              <div className="flex items-center justify-between px-4 py-3.5">
                <div>
                  <p className={`text-sm ${settings.notification_enabled ? 'text-zinc-700' : 'text-zinc-400'}`}>
                    予定削除通知
                  </p>
                  <p className="text-xs text-zinc-400 mt-0.5">家族が予定を削除したとき</p>
                </div>
                <Toggle
                  checked={settings.instant_event_deleted_enabled}
                  onChange={() => handleToggle('instant_event_deleted_enabled')}
                  disabled={!settings.notification_enabled}
                />
              </div>
            </div>
          </section>

        </div>
      </div>
    </>
  );
}
