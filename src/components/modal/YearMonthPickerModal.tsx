'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  currentYear: number;
  currentMonth: number;
  onConfirm: (year: number, month: number) => void;
  onClose: () => void;
}

export default function YearMonthPickerModal({
  currentYear,
  currentMonth,
  onConfirm,
  onClose,
}: Props) {
  const thisYear = new Date().getFullYear();
  const minYear = thisYear - 5;
  const maxYear = thisYear + 5;

  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);

  const handleConfirm = () => {
    onConfirm(selectedYear, selectedMonth);
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} aria-hidden="true" />

      <div
        className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100">
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex items-center text-sm text-zinc-500 px-1"
          >
            キャンセル
          </button>
          <span className="text-base font-semibold text-zinc-900">年月を選択</span>
          <button
            type="button"
            onClick={handleConfirm}
            className="h-11 flex items-center text-sm font-semibold text-blue-600 px-1"
          >
            移動
          </button>
        </div>

        {/* 年選択 */}
        <div className="flex items-center justify-center gap-8 py-5">
          <button
            type="button"
            onClick={() => setSelectedYear((y) => Math.max(minYear, y - 1))}
            disabled={selectedYear <= minYear}
            aria-label="前の年"
            className="p-2 text-zinc-400 disabled:opacity-30 active:opacity-60"
          >
            <ChevronLeft size={22} strokeWidth={2.5} />
          </button>
          <span className="text-xl font-semibold text-zinc-900 w-24 text-center tabular-nums">
            {selectedYear}年
          </span>
          <button
            type="button"
            onClick={() => setSelectedYear((y) => Math.min(maxYear, y + 1))}
            disabled={selectedYear >= maxYear}
            aria-label="次の年"
            className="p-2 text-zinc-400 disabled:opacity-30 active:opacity-60"
          >
            <ChevronRight size={22} strokeWidth={2.5} />
          </button>
        </div>

        {/* 月選択グリッド */}
        <div className="grid grid-cols-4 gap-2 px-4 pb-8">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
            const isSelected = m === selectedMonth;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setSelectedMonth(m)}
                className={`py-3 rounded-xl text-sm font-medium transition-colors ${
                  isSelected
                    ? 'bg-zinc-900 text-white'
                    : 'bg-zinc-100 text-zinc-700 active:bg-zinc-200'
                }`}
              >
                {m}月
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
