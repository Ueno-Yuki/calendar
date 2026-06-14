import type { EventTemplate, FamilyRole } from '@/types';
import { getRows, appendRow, updateRow, ensureSheet } from '@/lib/sheets';

export const TEMPLATE_SHEET_NAME = 'event_templates';

export const TEMPLATE_HEADERS = [
  'id', 'person', 'title', 'start_time', 'end_time',
  'location', 'memo', 'usage_count', 'last_used_at',
  'created_at', 'updated_at', 'deleted',
] as const;

export function parseTemplateRow(row: Record<string, string>): EventTemplate {
  return {
    id: row.id ?? '',
    person: (row.person as FamilyRole) ?? 'me',
    title: row.title ?? '',
    start_time: row.start_time ?? '',
    end_time: row.end_time ?? '',
    location: row.location ?? '',
    memo: row.memo ?? '',
    usage_count: parseInt(row.usage_count ?? '0', 10) || 0,
    last_used_at: row.last_used_at ?? '',
    created_at: row.created_at ?? '',
    updated_at: row.updated_at ?? '',
    deleted: row.deleted === 'TRUE',
  };
}

function templateToValues(t: EventTemplate): string[] {
  return [
    t.id, t.person, t.title, t.start_time, t.end_time,
    t.location, t.memo, String(t.usage_count), t.last_used_at,
    t.created_at, t.updated_at, t.deleted ? 'TRUE' : 'FALSE',
  ];
}

async function ensureTemplateSheet(): Promise<void> {
  await ensureSheet(TEMPLATE_SHEET_NAME, TEMPLATE_HEADERS);
}

/**
 * event_templates シートから候補を取得する。
 * title が指定されている場合は部分一致でフィルタし、
 * 完全一致 → 同一対象者 → 最近使用 → 使用回数 の優先順で最大 5 件返す。
 */
export async function getTemplateSuggestions(
  titleQuery: string,
  person: FamilyRole | null,
): Promise<EventTemplate[]> {
  await ensureTemplateSheet();
  const rows = await getRows(TEMPLATE_SHEET_NAME);
  const all = rows
    .filter((r) => r.deleted !== 'TRUE')
    .map(parseTemplateRow);

  const filtered = titleQuery
    ? all.filter((t) => t.title.includes(titleQuery))
    : all;

  filtered.sort((a, b) => {
    // 完全一致を優先
    const aExact = a.title === titleQuery ? 0 : 1;
    const bExact = b.title === titleQuery ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;

    // 同一対象者を優先
    const aSame = person && a.person === person ? 0 : 1;
    const bSame = person && b.person === person ? 0 : 1;
    if (aSame !== bSame) return aSame - bSame;

    // 最近使った順
    if (a.last_used_at !== b.last_used_at) {
      return b.last_used_at.localeCompare(a.last_used_at);
    }

    // 使用回数が多い順
    return b.usage_count - a.usage_count;
  });

  return filtered.slice(0, 5);
}

/**
 * 指定 id のテンプレートを論理削除する。
 * person が requesterRole と一致しない場合は 'forbidden' を返す。
 */
export async function deleteTemplate(
  id: string,
  requesterRole: FamilyRole,
): Promise<'ok' | 'not_found' | 'forbidden'> {
  await ensureTemplateSheet();
  const rows = await getRows(TEMPLATE_SHEET_NAME);
  const idx = rows.findIndex((r) => r.id === id && r.deleted !== 'TRUE');
  if (idx === -1) return 'not_found';

  const template = parseTemplateRow(rows[idx]);
  if (template.person !== requesterRole) return 'forbidden';

  const now = new Date().toISOString();
  const deleted: EventTemplate = { ...template, deleted: true, updated_at: now };
  await updateRow(TEMPLATE_SHEET_NAME, idx, templateToValues(deleted));
  return 'ok';
}

/**
 * 予定登録時にテンプレートを upsert する。
 * キー: person + title + start_time + end_time
 * - 存在する場合: usage_count++、last_used_at/location/memo を更新
 * - 存在しない場合: 新規作成（usage_count=1）
 */
export async function upsertTemplate(input: {
  person: FamilyRole;
  title: string;
  start_time: string;
  end_time: string;
  location: string;
  memo: string;
}): Promise<void> {
  await ensureTemplateSheet();
  const rows = await getRows(TEMPLATE_SHEET_NAME);
  const now = new Date().toISOString();

  const idx = rows.findIndex(
    (r) =>
      r.person === input.person &&
      r.title === input.title &&
      r.start_time === input.start_time &&
      r.end_time === input.end_time &&
      r.deleted !== 'TRUE',
  );

  if (idx !== -1) {
    const existing = parseTemplateRow(rows[idx]);
    const updated: EventTemplate = {
      ...existing,
      location: input.location,
      memo: input.memo,
      usage_count: existing.usage_count + 1,
      last_used_at: now,
      updated_at: now,
    };
    await updateRow(TEMPLATE_SHEET_NAME, idx, templateToValues(updated));
  } else {
    const newTemplate: EventTemplate = {
      id: crypto.randomUUID(),
      person: input.person,
      title: input.title,
      start_time: input.start_time,
      end_time: input.end_time,
      location: input.location,
      memo: input.memo,
      usage_count: 1,
      last_used_at: now,
      created_at: now,
      updated_at: now,
      deleted: false,
    };
    await appendRow(TEMPLATE_SHEET_NAME, templateToValues(newTemplate));
  }
}
