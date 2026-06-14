// かっぱシフト「ラスト」表示ユーティリティ
//
// 母がシフト予定に「かっぱ」または「カッパ」を含むタイトルで
// end_time = "23:59" を登録した場合、UI上は「ラスト」と表示する。
// 保存値は end_time = "23:59" のまま。新しいカラムは追加しない。

export const KAPPA_LAST_END_TIME = '23:59';

export function isKappaTitle(title: string): boolean {
  return title.includes('かっぱ') || title.includes('カッパ');
}

// ラスト表示条件を満たすかどうか
// - person または owner が mother
// - title に「かっぱ」または「カッパ」を含む
// - end_time === "23:59"
export function isKappaShiftLast(item: {
  person?: string;
  owner?: string;
  title: string;
  end_time: string;
}): boolean {
  const isMother = item.person === 'mother' || item.owner === 'mother';
  return isMother && isKappaTitle(item.title) && item.end_time === KAPPA_LAST_END_TIME;
}

// 終了時間を表示用テキストに変換
// ラスト条件を満たす場合は「ラスト」、それ以外は end_time をそのまま返す
export function formatEndTime(item: {
  person?: string;
  owner?: string;
  title: string;
  end_time: string;
}): string {
  if (isKappaShiftLast(item)) return 'ラスト';
  return item.end_time;
}

// 「開始〜終了」の表示文字列を返す（DayModal・カレンダーセル用）
export function formatEventTimeRange(item: {
  person?: string;
  owner?: string;
  title: string;
  start_time: string;
  end_time: string;
  all_day: boolean;
}): string {
  if (item.all_day || !item.start_time) return '';
  const endLabel = item.end_time ? formatEndTime(item) : '';
  if (!endLabel) return item.start_time;
  return `${item.start_time}〜${endLabel}`;
}
