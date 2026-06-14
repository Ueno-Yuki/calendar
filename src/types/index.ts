export type FamilyRole = 'mother' | 'father' | 'me' | 'brother';

export type EventSource = 'manual' | 'google';

export type NotificationType = 'daily_summary' | 'event_created' | 'event_deleted';

export type NotificationStatus = 'sent' | 'failed';

export interface Event {
  id: string;
  owner: FamilyRole;
  person: FamilyRole;
  title: string;
  start_date: string;   // YYYY-MM-DD
  end_date: string;     // YYYY-MM-DD
  start_time: string;   // HH:MM | ''
  end_time: string;     // HH:MM | ''
  location: string;
  memo: string;
  all_day: boolean;
  source: EventSource;
  google_event_id: string;
  created_at: string;   // ISO 8601
  updated_at: string;   // ISO 8601
  deleted: boolean;
}

export interface User {
  user_id: string;
  name: string;
  family_role: FamilyRole;
  token: string;
  notification_enabled: boolean;
  daily_summary_enabled: boolean;
  instant_event_created_enabled: boolean;
  instant_event_deleted_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface SyncMeta {
  key: string;
  value: string;
  updated_at: string;
}

export interface PushSubscription {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationLog {
  id: string;
  type: NotificationType;
  event_id: string;
  date: string;           // YYYY-MM-DD
  target_user_id: string;
  scheduled_at: string;
  sent_at: string;
  status: NotificationStatus;
  error_message: string;
  created_at: string;
}

export interface EventTemplate {
  id: string;
  person: FamilyRole;
  title: string;
  start_time: string;   // HH:MM | ''
  end_time: string;     // HH:MM | ''
  location: string;
  memo: string;
  usage_count: number;
  last_used_at: string;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}
