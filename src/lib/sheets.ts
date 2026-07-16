import { google } from 'googleapis';

// イベントシートの列順（仕様書 Section 19 に準拠）
export const EVENT_HEADERS = [
  'id', 'owner', 'person', 'title',
  'start_date', 'end_date', 'start_time', 'end_time',
  'location', 'memo', 'all_day', 'source',
  'google_event_id', 'created_at', 'updated_at', 'deleted', 'google_color_id',
] as const;

export type SheetWritableValue = string | number | boolean | null | undefined;

function isSheetNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybeError = error as {
    code?: number;
    message?: string;
    response?: { status?: number; data?: { error?: { message?: string } } };
  };
  const message = maybeError.response?.data?.error?.message ?? maybeError.message ?? '';
  return (
    maybeError.code === 400 ||
    maybeError.response?.status === 400
  ) && message.includes('Unable to parse range');
}

function getApiErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const maybeError = error as { code?: number; response?: { status?: number } };
  return maybeError.response?.status ?? maybeError.code;
}

function getApiErrorBodyMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const maybeError = error as {
    message?: string;
    response?: { data?: { error?: { message?: string } } };
  };
  return maybeError.response?.data?.error?.message ?? maybeError.message ?? '';
}

// Sheets API のレート制限(429)/クォータ超過エラーかどうかを判定する。
export function isQuotaExceededError(error: unknown): boolean {
  const status = getApiErrorStatus(error);
  const message = getApiErrorBodyMessage(error).toLowerCase();
  return (
    status === 429 ||
    message.includes('quota exceeded') ||
    message.includes('read requests per minute') ||
    message.includes('rate limit exceeded')
  );
}

// 429/クォータ超過エラー時のみ指数バックオフでリトライする。
async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= retries || !isQuotaExceededError(error)) throw error;
      const delayMs = 500 * 2 ** attempt + Math.random() * 200;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      attempt++;
    }
  }
}

let cachedSheetsClient: ReturnType<typeof google.sheets> | null = null;

function getSheetsClient() {
  if (cachedSheetsClient) return cachedSheetsClient;
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      // 環境変数中のリテラル \n を実際の改行に変換
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  cachedSheetsClient = google.sheets({ version: 'v4', auth });
  return cachedSheetsClient;
}

const getSpreadsheetId = () => {
  const id = process.env.GOOGLE_SPREADSHEET_ID;
  if (!id) throw new Error('GOOGLE_SPREADSHEET_ID is not set');
  return id;
};

/**
 * シート名から全行を取得する。
 * 1行目をヘッダーとして使用し、各行をオブジェクトとして返す。
 * シートが存在しない場合のみ空配列を返す。
 * Sheets API失敗・認証失敗・通信失敗は throw する。
 */
export async function getRows(sheetName: string): Promise<Record<string, string>[]> {
  try {
    const sheets = getSheetsClient();
    const res = await withRetry(() => sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: sheetName,
    }));
    const rows = res.data.values ?? [];
    if (rows.length < 2) return [];
    const headers = rows[0] as string[];
    return rows.slice(1).map((row) => {
      const record: Record<string, string> = {};
      headers.forEach((header, i) => {
        record[header] = (row[i] as string | undefined) ?? '';
      });
      return record;
    });
  } catch (error) {
    if (isSheetNotFoundError(error)) {
      return [];
    }
    throw error;
  }
}

/**
 * シートの末尾に行を追加する。
 */
export async function appendRow(sheetName: string, values: string[]): Promise<void> {
  await appendRows(sheetName, [values]);
}

/**
 * シートの末尾に複数行を1回のAPI呼び出しでまとめて追加する。
 */
export async function appendRows(sheetName: string, rows: string[][]): Promise<void> {
  if (rows.length === 0) return;
  const sheets = getSheetsClient();
  await withRetry(() => sheets.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  }));
}

/**
 * 指定した行を更新する。
 * dataRowIndex はヘッダー行を除いた 0 始まりのデータ行インデックス。
 * Google Sheets 上の実際の行番号は dataRowIndex + 2 になる
 * （row 1 = ヘッダー、row 2 = データ先頭）。
 * 例: dataRowIndex=0 → Sheets の row 2、dataRowIndex=1 → Sheets の row 3
 */
export async function updateRow(
  sheetName: string,
  dataRowIndex: number,
  values: string[],
): Promise<void> {
  const sheets = getSheetsClient();
  const sheetRowNumber = dataRowIndex + 2; // ヘッダーが row 1 のため +2
  await withRetry(() => sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `${sheetName}!A${sheetRowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [values] },
  }));
}

/**
 * 同一シート内の複数行（非連続でも可）を1回のAPI呼び出しでまとめて更新する。
 */
export async function batchUpdateRows(
  sheetName: string,
  updates: Array<{ dataRowIndex: number; values: string[] }>,
): Promise<void> {
  if (updates.length === 0) return;
  const sheets = getSheetsClient();
  await withRetry(() => sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: {
      valueInputOption: 'RAW',
      data: updates.map((u) => ({
        range: `${sheetName}!A${u.dataRowIndex + 2}`,
        values: [u.values],
      })),
    },
  }));
}

export async function getSheetHeaders(sheetName: string): Promise<string[]> {
  try {
    const sheets = getSheetsClient();
    const res = await withRetry(() => sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: `${sheetName}!1:1`,
    }));
    const headers = (res.data.values?.[0] as string[] | undefined) ?? [];
    return headers.length > 0 ? headers : [...EVENT_HEADERS];
  } catch {
    return [...EVENT_HEADERS];
  }
}

async function getHeadersMaybeCached(
  sheetName: string,
  headerCache?: Map<string, string[]>,
): Promise<string[]> {
  if (headerCache?.has(sheetName)) return headerCache.get(sheetName)!;
  const headers = await getSheetHeaders(sheetName);
  headerCache?.set(sheetName, headers);
  return headers;
}

function toCellString(value: SheetWritableValue): string {
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value ?? '');
}

export function buildValuesByHeaders(
  headers: readonly string[],
  record: Record<string, SheetWritableValue>,
): string[] {
  return headers.map((header) => toCellString(record[header]));
}

export async function appendRowByHeaders(
  sheetName: string,
  record: Record<string, SheetWritableValue>,
  headerCache?: Map<string, string[]>,
): Promise<void> {
  const headers = await getHeadersMaybeCached(sheetName, headerCache);
  await appendRow(sheetName, buildValuesByHeaders(headers, record));
}

export async function updateRowByHeaders(
  sheetName: string,
  dataRowIndex: number,
  record: Record<string, SheetWritableValue>,
  headerCache?: Map<string, string[]>,
): Promise<void> {
  const headers = await getHeadersMaybeCached(sheetName, headerCache);
  await updateRow(sheetName, dataRowIndex, buildValuesByHeaders(headers, record));
}

/**
 * 複数の新規行を1回のAPI呼び出しでまとめて追加する（ヘッダー変換込み）。
 */
export async function appendRowsByHeaders(
  sheetName: string,
  records: Record<string, SheetWritableValue>[],
  headerCache?: Map<string, string[]>,
): Promise<void> {
  if (records.length === 0) return;
  const headers = await getHeadersMaybeCached(sheetName, headerCache);
  await appendRows(sheetName, records.map((record) => buildValuesByHeaders(headers, record)));
}

/**
 * 複数行の更新を1回のAPI呼び出しでまとめて行う（ヘッダー変換込み）。
 */
export async function batchUpdateRowsByHeaders(
  sheetName: string,
  updates: Array<{ dataRowIndex: number; record: Record<string, SheetWritableValue> }>,
  headerCache?: Map<string, string[]>,
): Promise<void> {
  if (updates.length === 0) return;
  const headers = await getHeadersMaybeCached(sheetName, headerCache);
  await batchUpdateRows(
    sheetName,
    updates.map((u) => ({ dataRowIndex: u.dataRowIndex, values: buildValuesByHeaders(headers, u.record) })),
  );
}

/**
 * 年・月からシート名（YYYY-MM 形式）を生成する。
 */
export function getMonthSheetName(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * 指定シートが存在しなければ作成し、ヘッダー行を書き込む。
 * 既に存在する場合は何もしない。
 */
export async function ensureSheet(
  sheetName: string,
  headers: readonly string[],
): Promise<void> {
  const spreadsheetId = getSpreadsheetId();
  const sheets = getSheetsClient();

  const meta = await withRetry(() => sheets.spreadsheets.get({ spreadsheetId }));
  const exists = meta.data.sheets?.some((s) => s.properties?.title === sheetName) ?? false;

  if (exists) {
    const res = await withRetry(() => sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!1:1`,
    }));
    const currentHeaders = (res.data.values?.[0] as string[] | undefined) ?? [];
    const mergedHeaders = [...currentHeaders];
    headers.forEach((header) => {
      if (!mergedHeaders.includes(header)) mergedHeaders.push(header);
    });
    if (mergedHeaders.length !== currentHeaders.length) {
      await withRetry(() => sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [mergedHeaders] },
      }));
    }
    return;
  }

  await withRetry(() => sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: sheetName } } }],
    },
  }));

  await withRetry(() => sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [headers as unknown as string[]] },
  }));
}

/**
 * 月別イベントシートが存在しなければ作成し、ヘッダー行を書き込む。
 * 既に存在する場合は何もしない。
 */
export async function ensureMonthSheet(year: number, month: number): Promise<void> {
  await ensureSheet(getMonthSheetName(year, month), EVENT_HEADERS);
}

/**
 * スプレッドシート内の全 YYYY-MM 形式シート名を返す。
 * Google同期の既存マップ構築で全期間を網羅するために使用する。
 */
export async function getAllMonthSheetNames(): Promise<string[]> {
  const spreadsheetId = getSpreadsheetId();
  const sheets = getSheetsClient();
  const meta = await withRetry(() => sheets.spreadsheets.get({ spreadsheetId }));
  return (meta.data.sheets ?? [])
    .map((s) => s.properties?.title ?? '')
    .filter((name) => /^\d{4}-\d{2}$/.test(name));
}
