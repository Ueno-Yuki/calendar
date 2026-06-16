import { google } from 'googleapis';

// イベントシートの列順（仕様書 Section 19 に準拠）
export const EVENT_HEADERS = [
  'id', 'owner', 'person', 'title',
  'start_date', 'end_date', 'start_time', 'end_time',
  'location', 'memo', 'all_day', 'source',
  'google_event_id', 'created_at', 'updated_at', 'deleted',
] as const;

function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      // 環境変数中のリテラル \n を実際の改行に変換
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

const getSpreadsheetId = () => {
  const id = process.env.GOOGLE_SPREADSHEET_ID;
  if (!id) throw new Error('GOOGLE_SPREADSHEET_ID is not set');
  return id;
};

/**
 * シート名から全行を取得する。
 * 1行目をヘッダーとして使用し、各行をオブジェクトとして返す。
 * シートが存在しない場合は空配列を返す。
 */
export async function getRows(sheetName: string): Promise<Record<string, string>[]> {
  try {
    const sheets = getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: sheetName,
    });
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
  } catch {
    // シートが存在しない場合などは空配列を返す
    return [];
  }
}

/**
 * シートの末尾に行を追加する。
 */
export async function appendRow(sheetName: string, values: string[]): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [values] },
  });
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
  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `${sheetName}!A${sheetRowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [values] },
  });
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

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === sheetName) ?? false;

  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: sheetName } } }],
    },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [headers as unknown as string[]] },
  });
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
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  return (meta.data.sheets ?? [])
    .map((s) => s.properties?.title ?? '')
    .filter((name) => /^\d{4}-\d{2}$/.test(name));
}
