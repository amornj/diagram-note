import { Download, FilePlus2, Menu, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useMapStore } from '../lib/mapStore';
import { useEditorStore } from '../lib/store';
import { downloadBlob, exportDnote, importDnote } from '../lib/bundle';
import * as idb from '../lib/idb';

export default function ImportExportBar() {
  const rootRef = useRef<HTMLDivElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const dnoteInputRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeMapId = useMapStore((s) => s.activeMapId);
  const maps = useMapStore((s) => s.maps);
  const createMapFromPdf = useMapStore((s) => s.createMapFromPdf);
  const importDnoteMap = useMapStore((s) => s.importDnoteMap);
  const workspace = useEditorStore((s) => s.workspace);

  const activeMap = maps.find((m) => m.id === activeMapId);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [menuOpen]);

  const handlePdfPick = async (file: File) => {
    setBusy('Loading map…');
    setError(null);
    try {
      await createMapFromPdf(file, { scale: 2 });
      setMenuOpen(false);
    } catch (err) {
      setError((err as Error).message ?? 'Failed to load map');
    }
    setBusy(null);
  };

  const handleDnotePick = async (file: File) => {
    setBusy('Importing .dnote…');
    setError(null);
    try {
      const result = await importDnote(file);
      await importDnoteMap({ map: result.map, sourceBlob: result.sourceBlob });
      setMenuOpen(false);
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
      const sourceBlob = await idb.getPdfBlob(activeMap.id);
      if (!sourceBlob) throw new Error('Source file not found in storage');
      // Always export with the latest workspace from the editor store
      const result = await exportDnote(
        { ...activeMap, workspace, updatedAt: Date.now() },
        sourceBlob
      );
      downloadBlob(result.blob, result.filename);
      setMenuOpen(false);
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
    setMenuOpen(false);
  };

  return (
    <div ref={rootRef} className="relative flex items-center gap-2">
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf,.pdf,image/png,.png,image/jpeg,.jpg,.jpeg"
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
        onClick={() => setMenuOpen((value) => !value)}
        className={`rounded-md p-1.5 transition-colors ${
          menuOpen ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:bg-gray-100'
        }`}
        title="Open file menu"
        aria-label="Open file menu"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <Menu size={18} />
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-full z-40 mt-2 translate-x-12 w-56 rounded-2xl border border-gray-200 bg-white p-2 shadow-xl">
          <button
            onClick={() => pdfInputRef.current?.click()}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            role="menuitem"
          >
            <FilePlus2 size={14} />
            Load map
          </button>
          <button
            onClick={() => dnoteInputRef.current?.click()}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            role="menuitem"
          >
            <Upload size={14} />
            Load .dnote
          </button>
          <button
            onClick={handleExportDnote}
            disabled={!activeMap}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            role="menuitem"
          >
            <Download size={14} />
            Export .dnote
          </button>
          <button
            onClick={handleExportJson}
            disabled={!activeMap}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            role="menuitem"
          >
            <Download size={14} />
            Export JSON
          </button>
          {(busy || error) && <div className="my-2 border-t border-gray-100" />}
          {busy && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
              {busy}
            </div>
          )}
          {error && (
            <div className="mt-2 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} aria-label="Dismiss file menu error">
                <X size={12} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
