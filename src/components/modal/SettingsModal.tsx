'use client';

import { useState, useEffect } from 'react';
import { X, Bell, BellOff } from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';
import { STORAGE_KEY } from '@/lib/auth';
import type { StoredUser } from '@/lib/auth';
import { FAMILY_COLORS } from '@/lib/colors';
import type { FamilyRole } from '@/types';
import { subscribePush, getNotificationPermission } from '@/lib/pushClient';
import { DEFAULT_QUIET_HOURS } from '@/lib/quietHours';

interface NotificationSettings {
  notification_enabled: boolean;
  daily_summary_enabled: boolean;
  instant_event_created_enabled: boolean;
  instant_event_deleted_enabled: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
}

const DEFAULT_SETTINGS: NotificationSettings = {
  notification_enabled: true,
  daily_summary_enabled: true,
  instant_event_created_enabled: true,
  instant_event_deleted_enabled: true,
  ...DEFAULT_QUIET_HOURS,
};

type BooleanSettingKey =
  | 'notification_enabled'
  | 'daily_summary_enabled'
  | 'instant_event_created_enabled'
  | 'instant_event_deleted_enabled'
  | 'quiet_hours_enabled';

type TimeSettingKey = 'quiet_hours_start' | 'quiet_hours_end';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function buildTimeOptions(): string[] {
  const options: string[] = [];
  for (let h = 0; h < 24; h += 1) {
    for (let m = 0; m < 60; m += 5) {
      options.push(`${pad2(h)}:${pad2(m)}`);
    }
  }
  if (!options.includes(DEFAULT_QUIET_HOURS.quiet_hours_end)) {
    options.push(DEFAULT_QUIET_HOURS.quiet_hours_end);
    options.sort();
  }
  return options;
}

const TIME_OPTIONS = buildTimeOptions();

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
  const role = readCurrentRole();
  const [settings, setSettings] = useState<NotificationSettings>(DEFAULT_SETTINGS);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => getNotificationPermission());
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [justGranted, setJustGranted] = useState(false);

  useEffect(() => {
    if (!role) return;
    apiFetch('/api/settings/notifications')
      .then((res) => (res.ok ? (res.json() as Promise<NotificationSettings>) : null))
      .then((data) => {
        if (data) setSettings(data);
      })
      .catch(() => {});

  }, [role]);

  const saveSettings = (next: NotificationSettings) => {
    setSettings(next);
    apiFetch('/api/settings/notifications', {
      method: 'PUT',
      body: JSON.stringify(next),
    }).catch(() => {});
  };

  const handleToggle = (key: BooleanSettingKey) => {
    saveSettings({ ...settings, [key]: !settings[key] });
  };

  const handleTimeChange = (key: TimeSettingKey, value: string) => {
    saveSettings({ ...settings, [key]: value });
  };

  const handleRequestPermission = async () => {
    setIsSubscribing(true);
    try {
      // requestPermission はユーザー操作に紐づけて呼ぶ（ここはボタンのonClick内）
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === 'granted') {
        await subscribePush().catch(() => {});
        // 通知設定をONにする（デフォルト値だが明示的に保存）
        apiFetch('/api/settings/notifications', {
          method: 'PUT',
          body: JSON.stringify({
            notification_enabled: true,
            daily_summary_enabled: true,
            instant_event_created_enabled: true,
            instant_event_deleted_enabled: true,
          }),
        }).catch(() => {});
        setJustGranted(true);
      }
    } catch {
      setPermission(getNotificationPermission());
    } finally {
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
            </div>
          </section>

          <div className="h-px bg-zinc-100 mx-4" />

          {/* Push通知許可 */}
          <section className="px-4 pt-5 pb-4">
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-3">
              Push通知
            </p>

            {/* granted */}
            {permission === 'granted' && (
              <div className="flex items-start gap-3">
                <Bell size={18} className="text-green-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-green-700">通知は許可されています</p>
                  <p className="text-xs text-zinc-400 mt-0.5">この端末は通知を受信できます</p>
                  {justGranted && (
                    <p className="text-xs text-green-600 font-medium mt-1.5">通知を許可しました</p>
                  )}
                </div>
              </div>
            )}

            {/* default — ボタンのonClick内でのみ requestPermission を呼ぶ */}
            {permission === 'default' && (
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <BellOff size={16} className="text-zinc-400 shrink-0" />
                  <span className="text-sm text-zinc-600">通知は未許可です</span>
                </div>
                <button
                  type="button"
                  disabled={isSubscribing}
                  onClick={handleRequestPermission}
                  className="text-xs px-3 py-1.5 rounded-full bg-blue-500 text-white font-medium disabled:opacity-50 shrink-0"
                >
                  {isSubscribing ? '処理中…' : '通知を許可する'}
                </button>
              </div>
            )}

            {/* denied — ボタンは表示しない。端末設定の案内を表示する */}
            {permission === 'denied' && (
              <div>
                <div className="flex items-start gap-3">
                  <BellOff size={18} className="text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-red-600">
                      通知が端末側で拒否されています
                    </p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      端末の設定から通知を許可してください。
                    </p>
                  </div>
                </div>
                <div className="mt-3 rounded-xl bg-zinc-50 p-3 space-y-2">
                  <p className="text-xs text-zinc-500">
                    <span className="font-medium text-zinc-600">iPhoneの場合：</span>
                    ホーム画面アプリまたはSafariの通知設定から許可してください。
                  </p>
                  <p className="text-xs text-zinc-500">
                    <span className="font-medium text-zinc-600">Androidの場合：</span>
                    ブラウザまたはPWAのサイト設定から通知を許可してください。
                  </p>
                </div>
              </div>
            )}

            {/* unsupported */}
            {permission === 'unsupported' && (
              <div className="flex items-center gap-2">
                <BellOff size={16} className="text-zinc-400" />
                <span className="text-sm text-zinc-400">
                  このブラウザは通知に対応していません
                </span>
              </div>
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
                  <p className="text-xs text-zinc-400 mt-0.5">毎朝6時にお知らせ</p>
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

          <div className="h-px bg-zinc-100 mx-4" />

          {/* お休みモード */}
          <section className="px-4 pt-5 pb-8">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
                  お休みモード
                </p>
                <p className="text-xs text-zinc-400 mt-1">通知を止める時間を設定します</p>
                <p className="text-xs text-zinc-400 mt-1">この設定をしても「今日の予定通知」は通知されます</p>
              </div>
              <Toggle
                checked={settings.quiet_hours_enabled}
                onChange={() => handleToggle('quiet_hours_enabled')}
              />
            </div>

            <div className="rounded-xl border border-zinc-100 overflow-hidden bg-zinc-50">
              <TimeSelectRow
                label="開始"
                value={settings.quiet_hours_start}
                onChange={(value) => handleTimeChange('quiet_hours_start', value)}
                disabled={!settings.quiet_hours_enabled}
              />
              <div className="h-px bg-zinc-100" />
              <TimeSelectRow
                label="終了"
                value={settings.quiet_hours_end}
                onChange={(value) => handleTimeChange('quiet_hours_end', value)}
                disabled={!settings.quiet_hours_enabled}
              />
            </div>
          </section>

        </div>
      </div>
    </>
  );
}

function TimeSelectRow({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center justify-between px-4 py-3.5 bg-white">
      <span className={`text-sm ${disabled ? 'text-zinc-400' : 'text-zinc-700'}`}>{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-lg bg-zinc-100 px-3 text-sm font-medium text-zinc-900 disabled:text-zinc-400 disabled:opacity-70"
      >
        {TIME_OPTIONS.map((time) => (
          <option key={time} value={time}>
            {time}
          </option>
        ))}
      </select>
    </label>
  );
}
