import { getRows, appendRow, updateRow, ensureSheet } from '@/lib/sheets';

const SHEET = 'sync_meta';
const HEADERS = ['key', 'value', 'updated_at'] as const;

async function ensureSyncMetaSheet(): Promise<void> {
  await ensureSheet(SHEET, HEADERS);
}

export async function getAllSyncMeta(): Promise<Map<string, string>> {
  const rows = await getRows(SHEET);
  const map = new Map<string, string>();
  rows.forEach((row) => {
    if (!row.key) return;
    map.set(row.key, row.value ?? '');
  });
  return map;
}

export async function getSyncMeta(key: string): Promise<string | null> {
  const map = await getAllSyncMeta();
  return map.get(key) ?? null;
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
