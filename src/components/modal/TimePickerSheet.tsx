'use client';

import { useEffect, useRef } from 'react';

// 5分単位の時刻候補（00:00 〜 23:55、288件）
const ALL_TIMES: string[] = [];
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 5) {
    ALL_TIMES.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
}

interface Props {
  value: string;          // 現在選択中の "HH:MM"
  isCurrentLast?: boolean; // 「ラスト」が現在選択中かどうか
  showLastOption?: boolean; // 「ラスト」候補を末尾に表示するかどうか
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
  const selectedRef = useRef<HTMLButtonElement>(null);

  // マウント後に現在の選択値へ自動スクロール
  useEffect(() => {
    requestAnimationFrame(() => {
      selectedRef.current?.scrollIntoView({ block: 'center' });
    });
  }, []);

  return (
    <>
      {/* バックドロップ */}
      <div
        className="fixed inset-0 bg-black/40 z-[60]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* ボトムシート */}
      <div className="fixed inset-x-0 bottom-0 z-[61] bg-white rounded-t-2xl flex flex-col max-h-[60dvh]">
        {/* ドラッグハンドル */}
        <div className="shrink-0 flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-zinc-200 rounded-full" />
        </div>

        {/* 時刻リスト */}
        <ul className="overflow-y-auto flex-1" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {ALL_TIMES.map((t) => {
            const isSelected = t === value && !isCurrentLast;
            return (
              <li key={t}>
                <button
                  ref={isSelected ? selectedRef : undefined}
                  type="button"
                  onClick={() => { onSelect(t); onClose(); }}
                  className={`w-full py-3.5 text-base text-center transition-colors ${
                    isSelected
                      ? 'font-semibold text-zinc-900 bg-zinc-50'
                      : 'text-zinc-600 active:bg-zinc-100'
                  }`}
                >
                  {t}
                </button>
              </li>
            );
          })}

          {/* ラスト（母+かっぱ条件時のみ、リスト末尾に表示） */}
          {showLastOption && (
            <li>
              <button
                ref={isCurrentLast ? selectedRef : undefined}
                type="button"
                onClick={() => { onSelectLast?.(); onClose(); }}
                className={`w-full py-3.5 text-base text-center transition-colors ${
                  isCurrentLast
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
    </>
  );
}
