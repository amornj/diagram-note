import { ArchiveRestore, Download, FileCode, FilePlus2, Menu, Package, RotateCcw, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { zipSync } from 'fflate';
import { useMapStore, loadMapPageView } from '../lib/mapStore';
import { FIXED_RENDER_SCALE } from '../lib/mapStore';
import { useEditorStore } from '../lib/store';
import { downloadBlob, exportDnote, importDnote } from '../lib/bundle';
import { buildMapOverlayPdf } from '../lib/exportPdf';
import { buildMapExportHtml } from '../lib/exportHtml';
import * as idb from '../lib/idb';
import type { MapWorkspace } from '../types';
import { EMPTY_WORKSPACE } from '../lib/workspace';

function isMapWorkspace(value: unknown): value is MapWorkspace {
  return (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    'primitives' in value &&
    Array.isArray((value as MapWorkspace).primitives)
  );
}

export default function ImportExportBar() {
  const rootRef = useRef<HTMLDivElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const dnoteInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [confirmPermanentDeleteId, setConfirmPermanentDeleteId] = useState<string | null>(null);
  const [deleteAllInput, setDeleteAllInput] = useState('');
  const activeMapId = useMapStore((s) => s.activeMapId);
  const maps = useMapStore((s) => s.maps);
  const createMapFromPdf = useMapStore((s) => s.createMapFromPdf);
  const importDnoteMap = useMapStore((s) => s.importDnoteMap);
  const clearMapOverlays = useMapStore((s) => s.clearMapOverlays);
  const restoreMap = useMapStore((s) => s.restoreMap);
  const permanentlyDeleteMap = useMapStore((s) => s.permanentlyDeleteMap);
  const saveActiveWorkspace = useMapStore((s) => s.saveActiveWorkspace);
  const workspace = useEditorStore((s) => s.workspace);
  const setWorkspace = useEditorStore((s) => s.setWorkspace);

  const activeMap = maps.find((m) => m.id === activeMapId && m.archivedAt === undefined);
  const exportableMaps = maps.filter((map) => map.archivedAt === undefined);
  const archivedMaps = maps
    .filter((map) => map.archivedAt !== undefined)
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
        setShowDeleteAllConfirm(false);
        setArchiveOpen(false);
        setConfirmPermanentDeleteId(null);
        setDeleteAllInput('');
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        setShowDeleteAllConfirm(false);
        setArchiveOpen(false);
        setConfirmPermanentDeleteId(null);
        setDeleteAllInput('');
      }
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
      await createMapFromPdf(file, { scale: FIXED_RENDER_SCALE });
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

  const handleExportAllDnotes = async () => {
    if (exportableMaps.length === 0) return;
    setError(null);
    try {
      const entries: Record<string, Uint8Array> = {};
      const usedNames = new Set<string>();
      let skipped = 0;
      let index = 0;
      for (const m of exportableMaps) {
        index += 1;
        setBusy(`Bundling ${index} of ${exportableMaps.length}…`);
        const sourceBlob = await idb.getPdfBlob(m.id);
        if (!sourceBlob) {
          skipped += 1;
          continue;
        }
        // Use the live workspace for the currently-open map; stored data for the rest.
        const mapForExport =
          m.id === activeMapId
            ? { ...m, workspace, updatedAt: Date.now() }
            : m;
        const result = await exportDnote(mapForExport, sourceBlob);
        let filename = result.filename;
        if (usedNames.has(filename)) {
          const dot = filename.lastIndexOf('.');
          const base = dot === -1 ? filename : filename.slice(0, dot);
          const ext = dot === -1 ? '' : filename.slice(dot);
          let n = 2;
          while (usedNames.has(`${base} (${n})${ext}`)) n += 1;
          filename = `${base} (${n})${ext}`;
        }
        usedNames.add(filename);
        entries[filename] = new Uint8Array(await result.blob.arrayBuffer());
      }
      if (Object.keys(entries).length === 0) {
        throw new Error('No source files available to bundle');
      }
      setBusy('Compressing archive…');
      const zipped = zipSync(entries);
      const zipBuf = new ArrayBuffer(zipped.length);
      new Uint8Array(zipBuf).set(zipped);
      const today = new Date().toISOString().slice(0, 10);
      const filename = `diagram-note maps ${today}.zip`;
      downloadBlob(new Blob([zipBuf], { type: 'application/zip' }), filename);
      if (skipped > 0) {
        setError(`${skipped} map${skipped === 1 ? '' : 's'} skipped (source file missing)`);
      }
      setMenuOpen(false);
    } catch (err) {
      setError((err as Error).message ?? 'Failed to bundle .dnote archive');
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

  const handleJsonPick = async (file: File) => {
    if (!activeMap) return;
    setBusy('Loading JSON…');
    setError(null);
    try {
      const raw = JSON.parse(await file.text()) as unknown;
      const nextWorkspace = isMapWorkspace(raw) ? raw : EMPTY_WORKSPACE;
      if (!isMapWorkspace(raw)) {
        throw new Error('Invalid workspace JSON');
      }
      setWorkspace(nextWorkspace);
      await saveActiveWorkspace(nextWorkspace);
      setMenuOpen(false);
    } catch (err) {
      setError((err as Error).message ?? 'Failed to load JSON');
    }
    setBusy(null);
  };

  const handleExportPdf = async () => {
    if (!activeMap) return;
    setBusy('Building PDF…');
    setError(null);
    try {
      const blob = await buildMapOverlayPdf(
        { ...activeMap, workspace },
        workspace
      );
      const safeName = activeMap.name.replace(/[^a-z0-9-_ ]+/gi, '_');
      const suffix =
        (activeMap.pageCount ?? 1) > 1 ? ` p${activeMap.pageIndex + 1}` : '';
      downloadBlob(blob, `${safeName}${suffix} overlays.pdf`);
      setMenuOpen(false);
    } catch (err) {
      setError((err as Error).message ?? 'Failed to export PDF');
    }
    setBusy(null);
  };

  const handleExportHtml = async () => {
    if (!activeMap) return;
    setBusy('Building viewer HTML…');
    setError(null);
    try {
      const view = await loadMapPageView(activeMap.id, activeMap.pageIndex);
      if (!view) throw new Error('Map raster not available');
      const result = await buildMapExportHtml({
        map: { ...activeMap, workspace },
        workspace,
        rasterBlob: view.rasterBlob,
        dims: view.dims,
      });
      downloadBlob(result.blob, result.filename);
      setMenuOpen(false);
    } catch (err) {
      setError((err as Error).message ?? 'Failed to export HTML');
    }
    setBusy(null);
  };

  const handleDeleteAllOverlays = async () => {
    if (!activeMap || deleteAllInput !== 'Delete all') return;
    setBusy('Deleting all overlays…');
    setError(null);
    try {
      await clearMapOverlays(activeMap.id);
      setDeleteAllInput('');
      setShowDeleteAllConfirm(false);
      setMenuOpen(false);
    } catch (err) {
      setError((err as Error).message ?? 'Failed to delete overlays');
    }
    setBusy(null);
  };

  const openPicker = (input: HTMLInputElement | null) => {
    if (!input) return;
    setError(null);
    try {
      if (typeof input.showPicker === 'function') {
        input.showPicker();
        return;
      }
    } catch {
      // Fall through to click() for browsers that expose showPicker but reject it here.
    }
    input.click();
  };

  return (
    <div ref={rootRef} className="relative flex items-center gap-2">
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf,.pdf,image/png,.png,image/jpeg,.jpg,.jpeg,image/webp,.webp"
        className="sr-only"
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
        className="sr-only"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          await handleDnotePick(file);
          if (dnoteInputRef.current) dnoteInputRef.current.value = '';
        }}
      />
      <input
        ref={jsonInputRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          await handleJsonPick(file);
          if (jsonInputRef.current) jsonInputRef.current.value = '';
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
            onClick={() => openPicker(pdfInputRef.current)}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            role="menuitem"
          >
            <FilePlus2 size={14} />
            Load map
          </button>
          <button
            onClick={() => openPicker(dnoteInputRef.current)}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            role="menuitem"
          >
            <Upload size={14} />
            Load .dnote
          </button>
          <button
            onClick={() => openPicker(jsonInputRef.current)}
            disabled={!activeMap}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            role="menuitem"
          >
            <Upload size={14} />
            Load JSON
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
            onClick={() => void handleExportAllDnotes()}
            disabled={exportableMaps.length === 0 || busy !== null}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            role="menuitem"
          >
            <Package size={14} />
            Export all .dnote (zip)
          </button>
          <button
            onClick={() => void handleExportPdf()}
            disabled={!activeMap || busy !== null}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            role="menuitem"
          >
            <Download size={14} />
            Export PDF (overlays)
          </button>
          <button
            onClick={() => void handleExportHtml()}
            disabled={!activeMap || busy !== null}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            role="menuitem"
          >
            <FileCode size={14} />
            Export HTML (viewer)
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
          <div className="my-2 border-t border-gray-100" />
          {!showDeleteAllConfirm ? (
            <button
              onClick={() => setShowDeleteAllConfirm(true)}
              disabled={!activeMap || busy !== null}
              className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              role="menuitem"
            >
              <span>Remove all overlays</span>
            </button>
          ) : (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3">
              <div className="text-xs font-semibold text-red-800">Delete all overlays on this map</div>
              <p className="mt-1 text-[11px] leading-4 text-red-700">
                Type <span className="font-semibold">Delete all</span> to confirm. This clears every page in the current map.
              </p>
              <input
                value={deleteAllInput}
                onChange={(event) => setDeleteAllInput(event.target.value)}
                placeholder="Delete all"
                className="mt-2 w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-red-300"
              />
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => {
                    setShowDeleteAllConfirm(false);
                    setDeleteAllInput('');
                  }}
                  className="flex-1 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleDeleteAllOverlays()}
                  disabled={deleteAllInput !== 'Delete all' || busy !== null}
                  className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Delete all
                </button>
              </div>
            </div>
          )}
          <div className="my-2 border-t border-gray-100" />
          <button
            onClick={() => setArchiveOpen((value) => !value)}
            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            role="menuitem"
          >
            <span className="flex items-center gap-2">
              <ArchiveRestore size={14} />
              Archive
            </span>
            <span className="text-[11px] text-gray-400">
              {archivedMaps.length} {archiveOpen ? '▼' : '▶'}
            </span>
          </button>
          {archiveOpen && (
            <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-2">
              {archivedMaps.length === 0 ? (
                <div className="px-2 py-2 text-xs text-gray-400">
                  Deleted maps will appear here.
                </div>
              ) : (
                <div className="max-h-56 space-y-2 overflow-y-auto">
                  {archivedMaps.map((map) => (
                    <div
                      key={map.id}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2"
                    >
                      <div className="truncate text-sm font-medium text-gray-800">{map.name}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => void restoreMap(map.id)}
                          className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 transition hover:bg-sky-100"
                        >
                          <RotateCcw size={11} />
                          Restore
                        </button>
                        {confirmPermanentDeleteId === map.id ? (
                          <>
                            <button
                              onClick={() => {
                                void permanentlyDeleteMap(map.id);
                                setConfirmPermanentDeleteId(null);
                              }}
                              className="rounded-full bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white"
                            >
                              Permanent delete
                            </button>
                            <button
                              onClick={() => setConfirmPermanentDeleteId(null)}
                              className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-semibold text-gray-600 transition hover:bg-gray-200"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setConfirmPermanentDeleteId(map.id)}
                            className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-600 transition hover:bg-red-100"
                          >
                            Permanent delete
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
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
