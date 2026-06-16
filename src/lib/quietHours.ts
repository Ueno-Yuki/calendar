export interface QuietHoursSettings {
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
}

export const DEFAULT_QUIET_HOURS: QuietHoursSettings = {
  quiet_hours_enabled: true,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:59',
};

const TIME_RE = /^\d{2}:\d{2}$/;

export function isValidTime(value: unknown): value is string {
  if (typeof value !== 'string' || !TIME_RE.test(value)) return false;
  const [h, m] = value.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

export function normalizeQuietHoursSettings(
  input: Partial<QuietHoursSettings>,
): QuietHoursSettings {
  return {
    quiet_hours_enabled: input.quiet_hours_enabled ?? DEFAULT_QUIET_HOURS.quiet_hours_enabled,
    quiet_hours_start: isValidTime(input.quiet_hours_start)
      ? input.quiet_hours_start
      : DEFAULT_QUIET_HOURS.quiet_hours_start,
    quiet_hours_end: isValidTime(input.quiet_hours_end)
      ? input.quiet_hours_end
      : DEFAULT_QUIET_HOURS.quiet_hours_end,
  };
}

function toMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

function getJstMinutes(date: Date): number {
  const hours = (date.getUTCHours() + 9) % 24;
  return hours * 60 + date.getUTCMinutes();
}

export function isInQuietHours(
  settings: QuietHoursSettings,
  date = new Date(),
): boolean {
  if (!settings.quiet_hours_enabled) return false;

  const start = toMinutes(settings.quiet_hours_start);
  const end = toMinutes(settings.quiet_hours_end);
  const current = getJstMinutes(date);

  if (start <= end) {
    return current >= start && current <= end;
  }

  return current >= start || current <= end;
}
