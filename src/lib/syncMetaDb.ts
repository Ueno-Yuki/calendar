import { getRows, appendRow, updateRow, ensureSheet } from '@/lib/sheets';

const SHEET = 'sync_meta';
const HEADERS = ['key', 'value', 'updated_at'] as const;

async function ensureSyncMetaSheet(): Promise<void> {
  await ensureSheet(SHEET, HEADERS);
}

export async function getSyncMeta(key: string): Promise<string | null> {
  await ensureSyncMetaSheet();
  const rows = await getRows(SHEET);
  const row = rows.find((r) => r.key === key);
  return row?.value ?? null;
}

export async function setSyncMeta(key: string, value: string): Promise<void> {
  await ensureSyncMetaSheet();
  const rows = await getRows(SHEET);
  const idx = rows.findIndex((r) => r.key === key);
  const now = new Date().toISOString();
  if (idx === -1) {
    await appendRow(SHEET, [key, value, now]);
  } else {
    await updateRow(SHEET, idx, [key, value, now]);
  }
}
