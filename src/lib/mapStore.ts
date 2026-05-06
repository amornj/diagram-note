import { create } from 'zustand';
import type { DiagramMap, MapWorkspace, PageMeta } from '../types';
import { EMPTY_WORKSPACE } from './workspace';
import * as idb from './idb';
import { detectSourceType, rasterizeSource } from './pdf';
import { useEditorStore } from './store';
import { makeRelatedPrimitiveKey } from './workspace';

const ACTIVE_MAP_STORAGE_KEY = 'diagram-note-active-map';
const DEFAULT_MAP_ASSET = '/FullSubwayMap_V1023_Web.pdf';
const DEFAULT_MAP_NAME = 'FullSubwayMap';

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
    sourceBlob: Blob;
  }) => Promise<string>;
  addPrimitiveBacklink: (
    sourcePageIndex: number,
    sourceId: string,
    targetPageIndex: number,
    targetId: string
  ) => Promise<void>;
  removePrimitiveBacklink: (
    sourcePageIndex: number,
    sourceId: string,
    targetPageIndex: number,
    targetId: string
  ) => Promise<void>;
  deleteMap: (id: string) => Promise<void>;
  renameMap: (id: string, name: string) => Promise<void>;
  reorderMaps: (fromIndex: number, toIndex: number) => Promise<void>;
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

function updatePrimitiveOnPage(
  map: DiagramMap,
  pageIndex: number,
  primitiveId: string,
  updater: (primitive: import('../types').Primitive) => import('../types').Primitive
): DiagramMap {
  const meta = getPageMeta(map, pageIndex);
  return withPageMeta(map, pageIndex, {
    ...meta,
    workspace: {
      ...meta.workspace,
      primitives: meta.workspace.primitives.map((primitive) =>
        primitive.id === primitiveId ? updater(primitive) : primitive
      ),
    },
  });
}

export const useMapStore = create<MapStoreState>((set, get) => ({
  maps: [],
  activeMapId: null,
  activeRasterUrl: null,
  loading: false,
  initialized: false,

  loadMaps: async () => {
    // Guard against concurrent calls (React StrictMode fires effects twice)
    if (get().loading || get().initialized) return;
    set({ loading: true });
    try {
      let maps = await idb.listMaps();

      // Ensure the built-in default map always exists.
      // This runs on first launch and also migrates existing users who had
      // the subway map loaded without the isDefault flag.
      if (!maps.some((m) => m.isDefault)) {
        // Pre-populate in-memory maps so createMapFromPdf's hash dedup check
        // can find maps that are already in IDB but not yet in state.
        set({ maps });
        const response = await fetch(DEFAULT_MAP_ASSET);
        if (!response.ok) {
          throw new Error(`Failed to load bundled default map: ${response.status}`);
        }
        const blob = await response.blob();
        const file = new File([blob], DEFAULT_MAP_ASSET.split('/').pop()!, {
          type: 'application/pdf',
        });
        const defaultId = await get().createMapFromPdf(file, { scale: 2, name: DEFAULT_MAP_NAME });
        // Mark whichever map was created or found (by pdfHash) as the default.
        const target = await idb.getMap(defaultId);
        if (target) {
          await idb.putMap({ ...target, isDefault: true, sortOrder: -1 });
        }
        maps = await idb.listMaps();
      }

      // Deduplicate: if multiple maps share the same pdfHash, keep the one
      // with isDefault:true, or else the most-recently updated one, and
      // delete the rest. This cleans up state left by the prior bug.
      const byHash = new Map<string, DiagramMap[]>();
      for (const m of maps) {
        if (!m.pdfHash) continue;
        const group = byHash.get(m.pdfHash) ?? [];
        group.push(m);
        byHash.set(m.pdfHash, group);
      }
      const dupeIdsToDelete: string[] = [];
      for (const group of byHash.values()) {
        if (group.length <= 1) continue;
        const keep =
          group.find((m) => m.isDefault) ??
          group.reduce((best, m) => (m.updatedAt > best.updatedAt ? m : best));
        for (const m of group) {
          if (m.id !== keep.id) dupeIdsToDelete.push(m.id);
        }
      }
      if (dupeIdsToDelete.length > 0) {
        await Promise.all(dupeIdsToDelete.map((id) => idb.deleteMap(id)));
        maps = maps.filter((m) => !dupeIdsToDelete.includes(m.id));
      }

      // Default map always sorts first; others by sortOrder then updatedAt.
      maps.sort((a, b) => {
        if (a.isDefault && !b.isDefault) return -1;
        if (!a.isDefault && b.isDefault) return 1;
        const oa = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
        const ob = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
        return oa !== ob ? oa - ob : b.updatedAt - a.updatedAt;
      });

      const persistedId = loadActiveId();
      const activeMapId =
        persistedId && maps.some((m) => m.id === persistedId) ? persistedId : maps[0]?.id ?? null;
      set({ maps, activeMapId, loading: false, initialized: true });
      if (activeMapId) {
        await get().setActiveMap(activeMapId);
      }
    } catch {
      set({ maps: [], activeMapId: null, activeRasterUrl: null, loading: false, initialized: true });
      useEditorStore.getState().setWorkspace(EMPTY_WORKSPACE);
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
      const sourceBlob = await idb.getPdfBlob(id);
      if (!sourceBlob) return;
      const result = await rasterizeSource(sourceBlob, {
        sourceType: map.sourceType ?? 'pdf',
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
      const sourceBlob = await idb.getPdfBlob(id);
      if (!sourceBlob) return;
      const result = await rasterizeSource(sourceBlob, {
        sourceType: map.sourceType ?? 'pdf',
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
    const sourceType = detectSourceType(file);
    const result = await rasterizeSource(file, {
      sourceType,
      scale,
      pageIndex: 0,
    });

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
          ? file.name.replace(/\.(pdf|png|jpe?g)$/i, '')
          : `Map ${get().maps.length + 1}`),
      pdfHash: result.hash,
      sourceType,
      sourceName: 'name' in file && typeof file.name === 'string' ? file.name : undefined,
      sourceMimeType: file.type || (sourceType === 'image' ? 'image/png' : 'application/pdf'),
      sortOrder: get().maps.length,
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

    set({ maps: [...get().maps, map] });
    await get().setActiveMap(id);
    return id;
  },

  importDnoteMap: async ({ map, sourceBlob }) => {
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
        sourceType: map.sourceType ?? existing.sourceType ?? 'pdf',
        sourceName: map.sourceName ?? existing.sourceName,
        sourceMimeType: map.sourceMimeType ?? existing.sourceMimeType,
        sortOrder: existing.sortOrder ?? map.sortOrder,
      };
      await idb.putMap(merged);
      set({
        maps: [merged, ...get().maps.filter((m) => m.id !== merged.id)],
      });
      await get().setActiveMap(merged.id);
      return merged.id;
    }
    // Fresh import — render the active page's raster from the pdf at requested scale.
    const sourceType = map.sourceType ?? 'pdf';
    const result = await rasterizeSource(sourceBlob, {
      sourceType,
      scale: map.renderScale,
      pageIndex: map.pageIndex,
    });
    const filledMap: DiagramMap = {
      ...map,
      sourceType,
      pageCount: map.pageCount ?? result.pageCount,
      sortOrder: map.sortOrder ?? get().maps.length,
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
    await idb.putPdfBlob(filledMap.id, sourceBlob);
    await idb.putRaster(
      filledMap.id,
      filledMap.renderScale,
      filledMap.pageIndex,
      result.blob,
      result.width,
      result.height
    );
    set({ maps: [...get().maps.filter((m) => m.id !== filledMap.id), filledMap] });
    await get().setActiveMap(filledMap.id);
    return filledMap.id;
  },

  addPrimitiveBacklink: async (sourcePageIndex, sourceId, targetPageIndex, targetId) => {
    const activeId = get().activeMapId;
    if (!activeId) return;
    const map = await idb.getMap(activeId);
    if (!map) return;
    const sourceKey = makeRelatedPrimitiveKey(sourceId, sourcePageIndex);
    const targetKey = makeRelatedPrimitiveKey(targetId, targetPageIndex);
    let updated = updatePrimitiveOnPage(map, sourcePageIndex, sourceId, (primitive) => ({
      ...primitive,
      relatedMemberKeys: Array.from(
        new Set([...(primitive.relatedMemberKeys ?? []), targetKey])
      ).filter((key) => key !== sourceKey),
    }));
    updated = updatePrimitiveOnPage(updated, targetPageIndex, targetId, (primitive) => ({
      ...primitive,
      relatedMemberKeys: Array.from(
        new Set([...(primitive.relatedMemberKeys ?? []), sourceKey])
      ).filter((key) => key !== targetKey),
    }));
    await idb.putMap(updated);
    set({
      maps: get().maps.map((entry) => (entry.id === updated.id ? updated : entry)),
    });
    useEditorStore.getState().setWorkspace(getPageMeta(updated, updated.pageIndex).workspace);
  },

  removePrimitiveBacklink: async (sourcePageIndex, sourceId, targetPageIndex, targetId) => {
    const activeId = get().activeMapId;
    if (!activeId) return;
    const map = await idb.getMap(activeId);
    if (!map) return;
    const sourceKey = makeRelatedPrimitiveKey(sourceId, sourcePageIndex);
    const targetKey = makeRelatedPrimitiveKey(targetId, targetPageIndex);
    let updated = updatePrimitiveOnPage(map, sourcePageIndex, sourceId, (primitive) => ({
      ...primitive,
      relatedMemberKeys: (primitive.relatedMemberKeys ?? []).filter(
        (key) => key !== targetKey
      ),
    }));
    updated = updatePrimitiveOnPage(updated, targetPageIndex, targetId, (primitive) => ({
      ...primitive,
      relatedMemberKeys: (primitive.relatedMemberKeys ?? []).filter(
        (key) => key !== sourceKey
      ),
    }));
    await idb.putMap(updated);
    set({
      maps: get().maps.map((entry) => (entry.id === updated.id ? updated : entry)),
    });
    useEditorStore.getState().setWorkspace(getPageMeta(updated, updated.pageIndex).workspace);
  },

  deleteMap: async (id) => {
    if (get().maps.find((m) => m.id === id)?.isDefault) return;
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

  reorderMaps: async (fromIndex, toIndex) => {
    const maps = [...get().maps];
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= maps.length ||
      toIndex >= maps.length ||
      fromIndex === toIndex
    ) {
      return;
    }
    const [moved] = maps.splice(fromIndex, 1);
    maps.splice(toIndex, 0, moved);
    const next = maps.map((map, index) => ({ ...map, sortOrder: index }));
    await Promise.all(next.map((map) => idb.putMap(map)));
    set({ maps: next });
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
