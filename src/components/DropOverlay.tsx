import { useEffect, useState } from 'react';
import { Upload } from 'lucide-react';
import { useMapStore } from '../lib/mapStore';
import { importDnote } from '../lib/bundle';

interface DropOverlayProps {
  onError?: (message: string) => void;
}

export default function DropOverlay({ onError }: DropOverlayProps) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const createMapFromPdf = useMapStore((s) => s.createMapFromPdf);
  const importDnoteMap = useMapStore((s) => s.importDnoteMap);

  useEffect(() => {
    let depth = 0;
    const onDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types?.includes('Files')) return;
      depth += 1;
      setOver(true);
    };
    const onDragLeave = () => {
      depth -= 1;
      if (depth <= 0) {
        depth = 0;
        setOver(false);
      }
    };
    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types?.includes('Files')) return;
      event.preventDefault();
    };
    const onDrop = async (event: DragEvent) => {
      if (!event.dataTransfer?.files?.length) return;
      event.preventDefault();
      depth = 0;
      setOver(false);
      const file = event.dataTransfer.files[0];
      const isDnote =
        file.name.toLowerCase().endsWith('.dnote') ||
        file.name.toLowerCase().endsWith('.zip');
      const isPdf =
        file.type === 'application/pdf' ||
        file.name.toLowerCase().endsWith('.pdf');
      setBusy(true);
      try {
        if (isDnote) {
          const result = await importDnote(file);
          await importDnoteMap(result);
        } else if (isPdf) {
          await createMapFromPdf(file, { scale: 2 });
        } else {
          onError?.('Unsupported file. Drop a .pdf or .dnote.');
        }
      } catch (err) {
        onError?.((err as Error).message ?? 'Failed to load file');
      }
      setBusy(false);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [createMapFromPdf, importDnoteMap, onError]);

  if (!over && !busy) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-sky-500/10 backdrop-blur-sm">
      <div className="rounded-3xl border-2 border-dashed border-sky-400 bg-white px-10 py-8 text-center shadow-2xl">
        <Upload className="mx-auto h-10 w-10 text-sky-500" />
        <div className="mt-4 text-sm font-bold text-slate-900">
          {busy ? 'Loading…' : 'Drop PDF or .dnote'}
        </div>
        <div className="mt-1 text-xs text-slate-500">
          {busy ? 'Rendering page…' : 'Release to open in the editor'}
        </div>
      </div>
    </div>
  );
}
