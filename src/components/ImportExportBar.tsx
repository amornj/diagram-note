import { Download, FilePlus2, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useMapStore } from '../lib/mapStore';
import { useEditorStore } from '../lib/store';
import { downloadBlob, exportDnote, importDnote } from '../lib/bundle';
import * as idb from '../lib/idb';

export default function ImportExportBar() {
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const dnoteInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeMapId = useMapStore((s) => s.activeMapId);
  const maps = useMapStore((s) => s.maps);
  const createMapFromPdf = useMapStore((s) => s.createMapFromPdf);
  const importDnoteMap = useMapStore((s) => s.importDnoteMap);
  const workspace = useEditorStore((s) => s.workspace);

  const activeMap = maps.find((m) => m.id === activeMapId);

  const handlePdfPick = async (file: File) => {
    setBusy('Rendering PDF…');
    setError(null);
    try {
      await createMapFromPdf(file, { scale: 2 });
    } catch (err) {
      setError((err as Error).message ?? 'Failed to load PDF');
    }
    setBusy(null);
  };

  const handleDnotePick = async (file: File) => {
    setBusy('Importing .dnote…');
    setError(null);
    try {
      const result = await importDnote(file);
      await importDnoteMap(result);
    } catch (err) {
      setError((err as Error).message ?? 'Failed to import .dnote');
    }
    setBusy(null);
  };

  const handleExportDnote = async () => {
    if (!activeMap) return;
    setBusy('Building .dnote…');
    setError(null);
    try {
      const pdfBlob = await idb.getPdfBlob(activeMap.id);
      if (!pdfBlob) throw new Error('PDF not found in storage');
      // Always export with the latest workspace from the editor store
      const result = await exportDnote(
        { ...activeMap, workspace, updatedAt: Date.now() },
        pdfBlob
      );
      downloadBlob(result.blob, result.filename);
    } catch (err) {
      setError((err as Error).message ?? 'Failed to export .dnote');
    }
    setBusy(null);
  };

  const handleExportJson = () => {
    if (!activeMap) return;
    const blob = new Blob([JSON.stringify(workspace, null, 2)], {
      type: 'application/json',
    });
    const filename = `${activeMap.name.replace(/[^a-z0-9-_ ]+/gi, '_')}.workspace.json`;
    downloadBlob(blob, filename);
  };

  return (
    <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
      {error && (
        <div className="flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">
          {error}
          <button onClick={() => setError(null)}>
            <X size={12} />
          </button>
        </div>
      )}
      {busy && (
        <div className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700">
          {busy}
        </div>
      )}
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          await handlePdfPick(file);
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
          await handleDnotePick(file);
          if (dnoteInputRef.current) dnoteInputRef.current.value = '';
        }}
      />
      <button
        onClick={() => pdfInputRef.current?.click()}
        className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
      >
        <FilePlus2 size={13} /> Load PDF
      </button>
      <button
        onClick={() => dnoteInputRef.current?.click()}
        className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
      >
        <Upload size={13} /> Load .dnote
      </button>
      <button
        onClick={handleExportDnote}
        disabled={!activeMap}
        className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Download size={13} /> Export .dnote
      </button>
      <button
        onClick={handleExportJson}
        disabled={!activeMap}
        className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Download size={13} /> Export JSON
      </button>
    </div>
  );
}
