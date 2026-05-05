import { create } from 'zustand';
import type { DiagramMap, MapWorkspace, PageMeta } from '../types';
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
  setActivePage: (pageIndex: number) => Promise<void>;
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

/**
 * Read the workspace + dims for a particular page out of a map.
 * Falls back to the top-level workspace+dims when the map predates
 * multi-page support and only the active page exists.
 */
function getPageMeta(map: DiagramMap, pageIndex: number): PageMeta {
  if (map.pages?.[pageIndex]) return map.pages[pageIndex];
  if (pageIndex === map.pageIndex) {
    return {
      workspace: map.workspace ?? EMPTY_WORKSPACE,
      sourceWidth: map.sourceWidth,
      sourceHeight: map.sourceHeight,
    };
  }
  return {
    workspace: EMPTY_WORKSPACE,
    sourceWidth: map.sourceWidth,
    sourceHeight: map.sourceHeight,
  };
}

/**
 * Produce a new DiagramMap with the given page's workspace+dims merged
 * into the pages map, and (if it's the active page) into the top-level
 * fields too. updatedAt is bumped.
 */
function withPageMeta(
  map: DiagramMap,
  pageIndex: number,
  meta: PageMeta
): DiagramMap {
  const pages = { ...(map.pages ?? {}), [pageIndex]: meta };
  const isActive = pageIndex === map.pageIndex;
  return {
    ...map,
    pages,
    sourceWidth: isActive ? meta.sourceWidth : map.sourceWidth,
    sourceHeight: isActive ? meta.sourceHeight : map.sourceHeight,
    workspace: isActive ? meta.workspace : map.workspace,
    updatedAt: Date.now(),
  };
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
    const activeMapId =
      persistedId && maps.some((m) => m.id === persistedId) ? persistedId : null;
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
      useEditorStore.getState().setWorkspace(EMPTY_WORKSPACE);
      return;
    }
    const map = await idb.getMap(id);
    if (!map) {
      saveActiveId(null);
      setObjectUrl(null);
      set({ activeMapId: null, activeRasterUrl: null });
      useEditorStore.getState().setWorkspace(EMPTY_WORKSPACE);
      return;
    }
    const pageIndex = map.pageIndex;
    let raster = await idb.getRaster(id, map.renderScale, pageIndex);
    if (!raster) {
      const pdfBlob = await idb.getPdfBlob(id);
      if (!pdfBlob) return;
      const result = await rasterizePdf(pdfBlob, {
        scale: map.renderScale,
        pageIndex,
      });
      await idb.putRaster(
        id,
        map.renderScale,
        pageIndex,
        result.blob,
        result.width,
        result.height
      );
      raster = {
        key: '',
        mapId: id,
        scale: map.renderScale,
        pageIndex,
        blob: result.blob,
        width: result.width,
        height: result.height,
      };
    }
    const url = URL.createObjectURL(raster.blob);
    setObjectUrl(url);

    // Sync map record dims with raster (in case of re-render mismatch)
    const meta = getPageMeta(map, pageIndex);
    const synced = withPageMeta(map, pageIndex, {
      ...meta,
      sourceWidth: raster.width,
      sourceHeight: raster.height,
    });

    set({
      activeMapId: id,
      activeRasterUrl: url,
      maps: get().maps.map((m) => (m.id === id ? synced : m)),
    });
    useEditorStore.getState().setWorkspace(meta.workspace);
  },

  setActivePage: async (pageIndex) => {
    const id = get().activeMapId;
    if (!id) return;
    const map = await idb.getMap(id);
    if (!map) return;
    if (pageIndex === map.pageIndex) return;
    if (pageIndex < 0 || pageIndex >= map.pageCount) return;

    // 1) Snapshot the current page's editor workspace into the map record.
    const currentWorkspace = useEditorStore.getState().workspace;
    const currentMeta = getPageMeta(map, map.pageIndex);
    let next: DiagramMap = withPageMeta(map, map.pageIndex, {
      ...currentMeta,
      workspace: currentWorkspace,
    });

    // 2) Ensure the destination page has a raster.
    let raster = await idb.getRaster(id, map.renderScale, pageIndex);
    if (!raster) {
      const pdfBlob = await idb.getPdfBlob(id);
      if (!pdfBlob) return;
      const result = await rasterizePdf(pdfBlob, {
        scale: map.renderScale,
        pageIndex,
      });
      await idb.putRaster(
        id,
        map.renderScale,
        pageIndex,
        result.blob,
        result.width,
        result.height
      );
      raster = {
        key: '',
        mapId: id,
        scale: map.renderScale,
        pageIndex,
        blob: result.blob,
        width: result.width,
        height: result.height,
      };
    }

    // 3) Switch the active page in the record + load the dest workspace.
    const destMeta = getPageMeta(next, pageIndex);
    next = {
      ...next,
      pageIndex,
      sourceWidth: raster.width,
      sourceHeight: raster.height,
      workspace: destMeta.workspace,
      pages: {
        ...(next.pages ?? {}),
        [pageIndex]: {
          ...destMeta,
          sourceWidth: raster.width,
          sourceHeight: raster.height,
        },
      },
    };
    await idb.putMap(next);

    const url = URL.createObjectURL(raster.blob);
    setObjectUrl(url);
    set({
      activeRasterUrl: url,
      maps: get().maps.map((m) => (m.id === id ? next : m)),
    });
    useEditorStore.getState().setWorkspace(destMeta.workspace);
  },

  createMapFromPdf: async (file, options) => {
    const scale = options?.scale ?? 2;
    const result = await rasterizePdf(file, { scale, pageIndex: 0 });

    const existing = get().maps.find((m) => m.pdfHash === result.hash);
    if (existing) {
      await get().setActiveMap(existing.id);
      return existing.id;
    }

    const id = `map-${Math.random().toString(36).slice(2, 12)}`;
    const blob = file instanceof Blob ? file : new Blob([file]);
    const now = Date.now();
    const initialMeta: PageMeta = {
      workspace: { version: 1, primitives: [] },
      sourceWidth: result.width,
      sourceHeight: result.height,
    };
    const map: DiagramMap = {
      id,
      name:
        options?.name ??
        ('name' in file && typeof file.name === 'string'
          ? file.name.replace(/\.pdf$/i, '')
          : `Map ${get().maps.length + 1}`),
      pdfHash: result.hash,
      pageIndex: 0,
      pageCount: result.pageCount,
      sourceWidth: result.width,
      sourceHeight: result.height,
      renderScale: scale,
      workspace: initialMeta.workspace,
      pages: { 0: initialMeta },
      createdAt: now,
      updatedAt: now,
    };
    await idb.putMap(map);
    await idb.putPdfBlob(id, blob);
    await idb.putRaster(id, scale, 0, result.blob, result.width, result.height);

    set({ maps: [map, ...get().maps] });
    await get().setActiveMap(id);
    return id;
  },

  importDnoteMap: async ({ map, pdfBlob }) => {
    const existing = get().maps.find((m) => m.pdfHash === map.pdfHash);
    if (existing) {
      const merged: DiagramMap = {
        ...existing,
        // Imported map's pages overwrite existing pages (workspace + dims)
        pages: { ...(existing.pages ?? {}), ...(map.pages ?? {}) },
        workspace: map.workspace,
        pageIndex: map.pageIndex,
        pageCount: map.pageCount ?? existing.pageCount,
        sourceWidth: map.sourceWidth,
        sourceHeight: map.sourceHeight,
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
    // Fresh import — render the active page's raster from the pdf at requested scale.
    const result = await rasterizePdf(pdfBlob, {
      scale: map.renderScale,
      pageIndex: map.pageIndex,
    });
    const filledMap: DiagramMap = {
      ...map,
      pageCount: map.pageCount ?? result.pageCount,
      sourceWidth: result.width,
      sourceHeight: result.height,
      pages: {
        ...(map.pages ?? {}),
        [map.pageIndex]: {
          workspace: map.workspace,
          sourceWidth: result.width,
          sourceHeight: result.height,
        },
      },
    };
    await idb.putMap(filledMap);
    await idb.putPdfBlob(filledMap.id, pdfBlob);
    await idb.putRaster(
      filledMap.id,
      filledMap.renderScale,
      filledMap.pageIndex,
      result.blob,
      result.width,
      result.height
    );
    set({ maps: [filledMap, ...get().maps.filter((m) => m.id !== filledMap.id)] });
    await get().setActiveMap(filledMap.id);
    return filledMap.id;
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
    const meta = getPageMeta(map, map.pageIndex);
    const updated = withPageMeta(map, map.pageIndex, {
      ...meta,
      workspace,
    });
    await idb.putMap(updated);
    set({
      maps: get().maps.map((m) => (m.id === id ? updated : m)),
    });
  },
}));

// Subscribe editor workspace changes → debounced persist to active map.
let saveTimer: number | null = null;
useEditorStore.subscribe((state, prev) => {
  if (state.workspace === prev.workspace) return;
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    useMapStore.getState().saveActiveWorkspace(state.workspace);
  }, 200);
});
