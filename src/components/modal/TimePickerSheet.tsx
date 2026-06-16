'use client';

import { useEffect, useRef, useState } from 'react';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

interface Props {
  value: string;           // "HH:MM"
  isCurrentLast?: boolean; // 「ラスト」が現在選択中
  showLastOption?: boolean; // 「ラスト」候補を表示するか
  onSelect: (time: string) => void;
  onSelectLast?: () => void;
  onClose: () => void;
}

export default function TimePickerSheet({
  value,
  isCurrentLast = false,
  showLastOption = false,
  onSelect,
  onSelectLast,
  onClose,
}: Props) {
  const parts = value ? value.split(':').map(Number) : [9, 0];
  const initH = isNaN(parts[0]) ? 9 : parts[0];
  const initM = isNaN(parts[1]) ? 0 : Math.round(parts[1] / 5) * 5 % 60;

  const [selectedHour, setSelectedHour] = useState(initH);
  const [selectedMinute, setSelectedMinute] = useState(initM);
  // ラストが現在有効かどうか（分タップで解除、完了時に反映）
  const [isLastSelected, setIsLastSelected] = useState(isCurrentLast);

  const hourRef = useRef<HTMLButtonElement>(null);
  const minuteRef = useRef<HTMLButtonElement>(null);
  const lastRef = useRef<HTMLButtonElement>(null);

  // マウント後に選択中の行へ自動スクロール
  useEffect(() => {
    requestAnimationFrame(() => {
      hourRef.current?.scrollIntoView({ block: 'center' });
      (isCurrentLast ? lastRef : minuteRef).current?.scrollIntoView({ block: 'center' });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConfirm = () => {
    if (isLastSelected) {
      onSelectLast?.();
    } else {
      onSelect(`${pad2(selectedHour)}:${pad2(selectedMinute)}`);
    }
    onClose();
  };

  return (
    <>
      {/* バックドロップ（キャンセル扱い） */}
      <div
        className="fixed inset-0 bg-black/40 z-[60]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* ボトムシート */}
      <div
        className="fixed inset-x-0 bottom-0 z-[61] bg-white rounded-t-2xl flex flex-col"
        style={{ maxHeight: '55dvh' }}
      >
        {/* ドラッグハンドル */}
        <div className="shrink-0 flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-zinc-200 rounded-full" />
        </div>

        {/* ヘッダー */}
        <div className="shrink-0 flex items-center justify-between px-5 py-2 border-b border-zinc-100">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-zinc-400 px-1 py-1"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="text-sm font-semibold text-zinc-900 px-1 py-1"
          >
            完了
          </button>
        </div>

        {/* 時・分 二列ピッカー */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* 時の列（0〜23） */}
          <ul className="flex-1 overflow-y-auto" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            {HOURS.map((hour) => {
              const isSel = hour === selectedHour && !isLastSelected;
              return (
                <li key={hour}>
                  <button
                    ref={hour === selectedHour ? hourRef : undefined}
                    type="button"
                    onClick={() => { setSelectedHour(hour); setIsLastSelected(false); }}
                    className={`w-full py-3.5 text-base text-center transition-colors ${
                      isSel
                        ? 'font-semibold text-zinc-900 bg-zinc-50'
                        : 'text-zinc-600 active:bg-zinc-100'
                    }`}
                  >
                    {pad2(hour)}
                  </button>
                </li>
              );
            })}
          </ul>

          {/* コロン区切り */}
          <div className="shrink-0 w-6 flex items-center justify-center text-zinc-400 font-medium text-lg pointer-events-none select-none">
            :
          </div>

          {/* 分の列（5分単位）＋ラスト */}
          <ul className="flex-1 overflow-y-auto" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            {MINUTES.map((minute) => {
              const isSel = minute === selectedMinute && !isLastSelected;
              return (
                <li key={minute}>
                  <button
                    ref={minute === selectedMinute ? minuteRef : undefined}
                    type="button"
                    onClick={() => { setSelectedMinute(minute); setIsLastSelected(false); }}
                    className={`w-full py-3.5 text-base text-center transition-colors ${
                      isSel
                        ? 'font-semibold text-zinc-900 bg-zinc-50'
                        : 'text-zinc-600 active:bg-zinc-100'
                    }`}
                  >
                    {pad2(minute)}
                  </button>
                </li>
              );
            })}

            {/* ラスト（母+かっぱタイトルのみ、分リストの末尾） */}
            {showLastOption && (
              <li>
                <button
                  ref={isLastSelected ? lastRef : undefined}
                  type="button"
                  onClick={() => { onSelectLast?.(); onClose(); }}
                  className={`w-full py-3.5 text-base text-center transition-colors ${
                    isLastSelected
                      ? 'font-semibold text-zinc-900 bg-zinc-50'
                      : 'text-zinc-600 active:bg-zinc-100'
                  }`}
                >
                  ラスト
                </button>
              </li>
            )}
          </ul>
        </div>
      </div>
    </>
  );
}
