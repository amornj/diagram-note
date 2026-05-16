import { useEffect } from 'react';

interface PhotoExpandOverlayProps {
  url: string;
  onClose: () => void;
}

export default function PhotoExpandOverlay({ url, onClose }: PhotoExpandOverlayProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex cursor-zoom-out items-center justify-center bg-slate-950/85 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <img
        src={url}
        alt=""
        className="max-h-full max-w-full rounded-lg shadow-2xl"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
      />
    </div>
  );
}
