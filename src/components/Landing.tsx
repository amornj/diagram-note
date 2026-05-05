import { FilePlus2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useMapStore } from '../lib/mapStore';
import { importDnote } from '../lib/bundle';

export default function Landing() {
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const dnoteInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [renderScale, setRenderScale] = useState(2);
  const createMapFromPdf = useMapStore((s) => s.createMapFromPdf);
  const importDnoteMap = useMapStore((s) => s.importDnoteMap);

  const handleFile = async (file: File) => {
    setError(null);
    const isDnote =
      file.name.toLowerCase().endsWith('.dnote') ||
      file.name.toLowerCase().endsWith('.zip');
    const isPdf =
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (isDnote) {
      setBusy('Importing .dnote…');
      try {
        const result = await importDnote(file);
        await importDnoteMap(result);
      } catch (err) {
        setError((err as Error).message ?? 'Invalid .dnote file');
      }
      setBusy(null);
      return;
    }
    if (isPdf) {
      setBusy('Rendering PDF…');
      try {
        await createMapFromPdf(file, { scale: renderScale });
      } catch (err) {
        setError((err as Error).message ?? 'Failed to load PDF');
      }
      setBusy(null);
      return;
    }
    setError('Unsupported file. Drop a .pdf or .dnote.');
  };

  return (
    <div
      className="flex h-screen w-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-200 px-6"
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={async (event) => {
        event.preventDefault();
        setDragOver(false);
        const file = event.dataTransfer.files?.[0];
        if (file) await handleFile(file);
      }}
    >
      <div
        className={`max-w-xl rounded-3xl border-2 border-dashed bg-white p-10 shadow-xl transition ${
          dragOver ? 'border-sky-400 bg-sky-50' : 'border-slate-200'
        }`}
      >
        <div className="text-center">
          <h1 className="text-3xl font-bold text-slate-900">diagram-note</h1>
          <p className="mt-3 text-sm text-slate-600">
            Drop a complex PDF diagram and start drawing study boxes, regions, and notes
            on top.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <input
            ref={pdfInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              await handleFile(file);
              if (pdfInputRef.current) pdfInputRef.current.value = '';
            }}
          />
          <input
            ref={dnoteInputRef}
            type="file"
            accept=".dnote,.zip,application/zip"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              await handleFile(file);
              if (dnoteInputRef.current) dnoteInputRef.current.value = '';
            }}
          />
          <button
            onClick={() => pdfInputRef.current?.click()}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            <FilePlus2 size={15} /> Load a PDF
          </button>
          <button
            onClick={() => dnoteInputRef.current?.click()}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <Upload size={15} /> Open a .dnote
          </button>
        </div>

        <div className="mt-5 flex items-center justify-center gap-3 text-xs text-slate-600">
          <span className="font-semibold uppercase tracking-wider text-slate-500">
            Render quality
          </span>
          {[1, 2, 3].map((value) => (
            <button
              key={value}
              onClick={() => setRenderScale(value)}
              className={`rounded-full px-3 py-1 font-semibold transition ${
                renderScale === value
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              {value}×
            </button>
          ))}
          <span className="text-[10px] text-slate-400">
            higher = sharper but slower / heavier
          </span>
        </div>

        <div className="mt-6 text-center text-xs text-slate-400">
          …or drop a file anywhere on this page.
        </div>

        {busy && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-700">
            {busy}
          </div>
        )}
        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-center text-xs font-medium text-red-700">
            {error}
          </div>
        )}

        <div className="mt-8 grid grid-cols-3 gap-3 text-[11px] text-slate-500">
          <Hint kbd="6" label="Study box" />
          <Hint kbd="8" label="Polyline / shape" />
          <Hint kbd="7" label="Group" />
          <Hint kbd="5" label="Search" />
          <Hint kbd="?" label="Hotkey help" />
          <Hint kbd="Space" label="Pan" />
        </div>
      </div>
    </div>
  );
}

function Hint({ kbd, label }: { kbd: string; label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-xl bg-slate-100 px-2 py-1.5">
      <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
        {kbd}
      </kbd>
      <span>{label}</span>
    </div>
  );
}
