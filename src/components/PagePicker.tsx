import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useMapStore } from '../lib/mapStore';

interface PagePickerProps {
  pageIndex: number;
  pageCount: number;
  inline?: boolean;
}

export default function PagePicker({
  pageIndex,
  pageCount,
  inline = false,
}: PagePickerProps) {
  const setActivePage = useMapStore((s) => s.setActivePage);
  const [busy, setBusy] = useState(false);

  if (pageCount <= 1) return null;

  const go = async (next: number) => {
    if (busy) return;
    setBusy(true);
    try {
      await setActivePage(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`flex items-center gap-1 rounded-full border border-white/10 bg-black/60 px-2 py-1 text-xs font-medium text-white/90 backdrop-blur ${
        inline ? '' : 'absolute bottom-4 left-1/2 z-10 -translate-x-1/2'
      }`}
    >
      <button
        onClick={() => go(pageIndex - 1)}
        disabled={pageIndex <= 0 || busy}
        className="rounded-full p-1 transition hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent"
        aria-label="Previous page"
      >
        <ChevronLeft size={14} />
      </button>
      <span className="px-2 tabular-nums">
        Page {pageIndex + 1} / {pageCount}
      </span>
      <button
        onClick={() => go(pageIndex + 1)}
        disabled={pageIndex >= pageCount - 1 || busy}
        className="rounded-full p-1 transition hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent"
        aria-label="Next page"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}
