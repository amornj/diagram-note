import { create } from 'zustand';
import type { DiagramMap, MapWorkspace } from '../types';
import { EMPTY_WORKSPACE } from './workspace';
import * as idb from './idb';
import { rasterizePdf } from './pdf';
import { useEditorStore } from './store';

const ACTIVE_MAP_STORAGE_KEY = 'diagram-note-active-map';

export interface MapStoreState {
  maps: DiagramMap[];
  activeMapId: string | null;
  activeRasterUrl: string | null;
  loading: boolean;
  initialized: boolean;
  loadMaps: () => Promise<void>;
  setActiveMap: (id: string | null) => Promise<void>;
  createMapFromPdf: (
    file: File | Blob,
    options?: { scale?: number; name?: string }
  ) => Promise<string>;
  importDnoteMap: (args: {
    map: DiagramMap;
    pdfBlob: Blob;
  }) => Promise<string>;
  deleteMap: (id: string) => Promise<void>;
  renameMap: (id: string, name: string) => Promise<void>;
  saveActiveWorkspace: (workspace: MapWorkspace) => Promise<void>;
}

let lastObjectUrl: string | null = null;

function setObjectUrl(url: string | null) {
  if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
  lastObjectUrl = url;
}

function loadActiveId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACTIVE_MAP_STORAGE_KEY);
}

function saveActiveId(id: string | null) {
  if (typeof window === 'undefined') return;
  if (id) window.localStorage.setItem(ACTIVE_MAP_STORAGE_KEY, id);
  else window.localStorage.removeItem(ACTIVE_MAP_STORAGE_KEY);
}

export const useMapStore = create<MapStoreState>((set, get) => ({
  maps: [],
  activeMapId: null,
  activeRasterUrl: null,
  loading: false,
  initialized: false,

  loadMaps: async () => {
    set({ loading: true });
    const maps = await idb.listMaps();
    const persistedId = loadActiveId();
    const activeMapId = persistedId && maps.some((m) => m.id === persistedId)
      ? persistedId
      : null;
    set({ maps, activeMapId, loading: false, initialized: true });
    if (activeMapId) {
      await get().setActiveMap(activeMapId);
    }
  },

  setActiveMap: async (id) => {
    saveActiveId(id);
    if (!id) {
      setObjectUrl(null);
      set({ activeMapId: null, activeRasterUrl: null });
      useEditorStore.getState().setWorkspace({ version: 1, primitives: [] });
      return;
    }
    const map = await idb.getMap(id);
    if (!map) {
      saveActiveId(null);
      setObjectUrl(null);
      set({ activeMapId: null, activeRasterUrl: null });
      useEditorStore.getState().setWorkspace({ version: 1, primitives: [] });
      return;
    }
    let raster = await idb.getRaster(id, map.renderScale);
    if (!raster) {
      // raster missing for some reason — re-render from pdf
      const pdfBlob = await idb.getPdfBlob(id);
      if (!pdfBlob) {
        // can't recover
        return;
      }
      const result = await rasterizePdf(pdfBlob, {
        scale: map.renderScale,
        pageIndex: map.pageIndex,
      });
      await idb.putRaster(id, map.renderScale, result.blob, result.width, result.height);
      raster = {
        key: '',
        mapId: id,
        scale: map.renderScale,
        blob: result.blob,
        width: result.width,
        height: result.height,
      };
    }
    const url = URL.createObjectURL(raster.blob);
    setObjectUrl(url);
    set({
      activeMapId: id,
      activeRasterUrl: url,
    });
    useEditorStore.getState().setWorkspace(map.workspace ?? EMPTY_WORKSPACE);
  },

  createMapFromPdf: async (file, options) => {
    const scale = options?.scale ?? 2;
    const result = await rasterizePdf(file, { scale, pageIndex: 0 });

    // Reuse existing map if same hash already loaded
    const existing = get().maps.find((m) => m.pdfHash === result.hash);
    if (existing) {
      await get().setActiveMap(existing.id);
      return existing.id;
    }

    const id = `map-${Math.random().toString(36).slice(2, 12)}`;
    const blob = file instanceof Blob ? file : new Blob([file]);
    const now = Date.now();
    const map: DiagramMap = {
      id,
      name:
        options?.name ??
        ('name' in file && typeof file.name === 'string'
          ? file.name.replace(/\.pdf$/i, '')
          : `Map ${get().maps.length + 1}`),
      pdfHash: result.hash,
      pageIndex: 0,
      sourceWidth: result.width,
      sourceHeight: result.height,
      renderScale: scale,
      workspace: { version: 1, primitives: [] },
      createdAt: now,
      updatedAt: now,
    };
    await idb.putMap(map);
    await idb.putPdfBlob(id, blob);
    await idb.putRaster(id, scale, result.blob, result.width, result.height);

    set({ maps: [map, ...get().maps] });
    await get().setActiveMap(id);
    return id;
  },

  importDnoteMap: async ({ map, pdfBlob }) => {
    // If hash conflict — reuse existing id; otherwise insert as-is.
    const existing = get().maps.find((m) => m.pdfHash === map.pdfHash);
    if (existing) {
      const merged: DiagramMap = {
        ...existing,
        workspace: map.workspace,
        updatedAt: Date.now(),
        name: map.name || existing.name,
      };
      await idb.putMap(merged);
      set({
        maps: [merged, ...get().maps.filter((m) => m.id !== merged.id)],
      });
      await get().setActiveMap(merged.id);
      return merged.id;
    }
    // Fresh import — re-render the raster from the pdf at requested scale
    const result = await rasterizePdf(pdfBlob, {
      scale: map.renderScale,
      pageIndex: map.pageIndex,
    });
    await idb.putMap(map);
    await idb.putPdfBlob(map.id, pdfBlob);
    await idb.putRaster(map.id, map.renderScale, result.blob, result.width, result.height);
    set({ maps: [map, ...get().maps.filter((m) => m.id !== map.id)] });
    await get().setActiveMap(map.id);
    return map.id;
  },

  deleteMap: async (id) => {
    await idb.deleteMap(id);
    const next = get().maps.filter((m) => m.id !== id);
    set({ maps: next });
    if (get().activeMapId === id) {
      await get().setActiveMap(next[0]?.id ?? null);
    }
  },

  renameMap: async (id, name) => {
    const map = await idb.getMap(id);
    if (!map) return;
    const updated: DiagramMap = { ...map, name, updatedAt: Date.now() };
    await idb.putMap(updated);
    set({
      maps: get().maps.map((m) => (m.id === id ? updated : m)),
    });
  },

  saveActiveWorkspace: async (workspace) => {
    const id = get().activeMapId;
    if (!id) return;
    const map = await idb.getMap(id);
    if (!map) return;
    const updated: DiagramMap = {
      ...map,
      workspace,
      updatedAt: Date.now(),
    };
    await idb.putMap(updated);
    set({
      maps: get().maps.map((m) => (m.id === id ? updated : m)),
    });
  },
}));

// Workspace persistence: subscribe to editor workspace changes and write through
// to IDB for the active map. Debounced to avoid hammering.
let saveTimer: number | null = null;
useEditorStore.subscribe((state, prev) => {
  if (state.workspace === prev.workspace) return;
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    useMapStore.getState().saveActiveWorkspace(state.workspace);
  }, 200);
});
