import { create } from 'zustand';
import type { DiagramMap, MapWorkspace, PageMeta, Primitive } from '../types';
import { EMPTY_WORKSPACE } from './workspace';
import * as idb from './idb';
import { detectSourceType, rasterizeSource } from './pdf';
import { useEditorStore } from './store';
import { makeRelatedPrimitiveKey } from './workspace';
import { auth } from './firebase';
import {
  deleteMapSource,
  downloadMapSource,
  mapSourcePath,
  uploadMapSource,
} from './cloudStorage';

const ACTIVE_MAP_STORAGE_KEY = 'diagram-note-active-map';
const DEFAULT_MAP_ASSET = '/metabolic-map.pdf';
const DEFAULT_MAP_NAME = 'metabolic-map';
export const FIXED_RENDER_SCALE = 1.5;

function debugMap(message: string, details?: Record<string, unknown>) {
  if (details) console.info(`[map] ${message}`, details);
  else console.info(`[map] ${message}`);
}

export interface MapStoreState {
  maps: DiagramMap[];
  activeMapId: string | null;
  activeRasterUrl: string | null;
  loading: boolean;
  initialized: boolean;
  loadMaps: () => Promise<void>;
  setActiveMap: (id: string | null) => Promise<boolean>;
  setActivePage: (pageIndex: number) => Promise<void>;
  createMapFromPdf: (
    file: File | Blob,
    options?: { scale?: number; name?: string }
  ) => Promise<string>;
  importDnoteMap: (args: {
    map: DiagramMap;
    sourceBlob: Blob;
  }) => Promise<string>;
  clearMapOverlays: (id: string) => Promise<void>;
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
  patchMapPrimitive: (
    mapId: string,
    pageIndex: number,
    primitiveId: string,
    patch: Partial<Primitive>
  ) => Promise<void>;
}

export interface MapPageView {
  map: DiagramMap;
  pageIndex: number;
  pageCount: number;
  rasterBlob: Blob;
  dims: { width: number; height: number };
}

interface LoadedMapPage {
  map: DiagramMap;
  pageIndex: number;
  pageCount: number;
  raster: {
    blob: Blob;
    width: number;
    height: number;
  };
}

let lastObjectUrl: string | null = null;

function setObjectUrl(url: string | null) {
  if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
  lastObjectUrl = url;
}

function saveActiveId(id: string | null) {
  if (typeof window === 'undefined') return;
  if (id) window.localStorage.setItem(ACTIVE_MAP_STORAGE_KEY, id);
  else window.localStorage.removeItem(ACTIVE_MAP_STORAGE_KEY);
}

async function loadMapPage(
  mapId: string,
  requestedPageIndex?: number,
  options?: { touchLastOpened?: boolean }
): Promise<LoadedMapPage | null> {
  const map = await idb.getMap(mapId);
  if (!map) return null;
  const pageIndex = Math.min(
    Math.max(requestedPageIndex ?? map.pageIndex, 0),
    Math.max(0, map.pageCount - 1)
  );
  let workingMap = map;
  if (options?.touchLastOpened) {
    workingMap = { ...workingMap, lastOpenedAt: Date.now() };
    await idb.putMap(workingMap);
  }

  let raster = await idb.getRaster(workingMap.id, workingMap.renderScale, pageIndex);
  if (!raster) {
    const sourceBlob = await resolveSourceBlob(workingMap);
    if (!sourceBlob) return null;
    const result = await rasterizeSource(sourceBlob, {
      sourceType: workingMap.sourceType ?? 'pdf',
      scale: workingMap.renderScale,
      pageIndex,
    });
    await idb.putRaster(
      workingMap.id,
      workingMap.renderScale,
      pageIndex,
      result.blob,
      result.width,
      result.height
    );
    raster = {
      key: '',
      mapId: workingMap.id,
      scale: workingMap.renderScale,
      pageIndex,
      blob: result.blob,
      width: result.width,
      height: result.height,
    };
  }

  const meta = getPageMeta(workingMap, pageIndex);
  const pageDimsChanged =
    meta.sourceWidth !== raster.width || meta.sourceHeight !== raster.height;
  const topLevelDimsChanged =
    pageIndex === workingMap.pageIndex &&
    (workingMap.sourceWidth !== raster.width || workingMap.sourceHeight !== raster.height);

  if (pageDimsChanged || topLevelDimsChanged) {
    workingMap = {
      ...workingMap,
      sourceWidth: pageIndex === workingMap.pageIndex ? raster.width : workingMap.sourceWidth,
      sourceHeight: pageIndex === workingMap.pageIndex ? raster.height : workingMap.sourceHeight,
      pages: {
        ...(workingMap.pages ?? {}),
        [pageIndex]: {
          ...meta,
          sourceWidth: raster.width,
          sourceHeight: raster.height,
        },
      },
      updatedAt: Date.now(),
    };
    await idb.putMap(workingMap);
  }

  return {
    map: workingMap,
    pageIndex,
    pageCount: workingMap.pageCount,
    raster: {
      blob: raster.blob,
      width: raster.width,
      height: raster.height,
    },
  };
}

async function ensureRemoteSource(
  map: DiagramMap,
  sourceBlob: Blob
): Promise<DiagramMap> {
  const uid = auth?.currentUser?.uid;
  debugMap('ensure remote source', {
    mapId: map.id,
    name: map.name,
    uid: uid ?? null,
    hasSourceStoragePath: Boolean(map.sourceStoragePath),
    sourceSize: sourceBlob.size,
  });
  if (!uid || map.sourceStoragePath) return map;
  try {
    const sourceStoragePath = await uploadMapSource(
      uid,
      map.id,
      sourceBlob,
      map.sourceMimeType
    );
    if (!sourceStoragePath) return map;
    return {
      ...map,
      sourceStoragePath,
      updatedAt: Date.now(),
    };
  } catch (error) {
    console.error('[storage] source upload failed:', error);
    return map;
  }
}

async function resolveSourceBlob(map: DiagramMap): Promise<Blob | null> {
  debugMap('resolve source start', {
    mapId: map.id,
    name: map.name,
    isDefault: Boolean(map.isDefault),
    sourceStoragePath: map.sourceStoragePath ?? null,
    uid: auth?.currentUser?.uid ?? null,
  });
  let sourceBlob = await idb.getPdfBlob(map.id);
  if (sourceBlob) {
    debugMap('resolved source from idb', {
      mapId: map.id,
      size: sourceBlob.size,
      type: sourceBlob.type,
    });
    return sourceBlob;
  }

  if (map.isDefault) {
    try {
      debugMap('fetching bundled default source', {
        mapId: map.id,
        asset: DEFAULT_MAP_ASSET,
      });
      const response = await fetch(DEFAULT_MAP_ASSET);
      if (!response.ok) return null;
      sourceBlob = await response.blob();
      await idb.putPdfBlob(map.id, sourceBlob);
      debugMap('resolved source from bundled default', {
        mapId: map.id,
        size: sourceBlob.size,
        type: sourceBlob.type,
      });
      return sourceBlob;
    } catch (error) {
      console.error('[map] default source fetch failed:', error);
      return null;
    }
  }

  const storagePaths = new Set<string>();
  if (map.sourceStoragePath) storagePaths.add(map.sourceStoragePath);
  const uid = auth?.currentUser?.uid;
  if (uid) storagePaths.add(mapSourcePath(uid, map.id));
  debugMap('trying storage paths', {
    mapId: map.id,
    paths: Array.from(storagePaths),
  });

  for (const path of storagePaths) {
    try {
      debugMap('trying storage source path', { mapId: map.id, path });
      sourceBlob = await downloadMapSource(path);
      if (sourceBlob) {
        await idb.putPdfBlob(map.id, sourceBlob);
        debugMap('resolved source from storage', {
          mapId: map.id,
          path,
          size: sourceBlob.size,
          type: sourceBlob.type,
        });
        if (map.sourceStoragePath !== path) {
          const updated = { ...map, sourceStoragePath: path, updatedAt: Date.now() };
          await idb.putMap(updated);
          setTimeout(() => {
            useMapStore.setState((state) => ({
              maps: state.maps.map((entry) => (entry.id === updated.id ? updated : entry)),
            }));
          }, 0);
        }
        return sourceBlob;
      }
    } catch (error) {
      console.error(`[storage] source download failed for ${path}:`, error);
    }
  }

  debugMap('resolve source failed', {
    mapId: map.id,
    name: map.name,
    sourceStoragePath: map.sourceStoragePath ?? null,
    uid: auth?.currentUser?.uid ?? null,
  });
  return null;
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

export async function loadMapPageView(
  mapId: string,
  requestedPageIndex?: number
): Promise<MapPageView | null> {
  const loaded = await loadMapPage(mapId, requestedPageIndex);
  if (!loaded) return null;
  return {
    map: loaded.map,
    pageIndex: loaded.pageIndex,
    pageCount: loaded.pageCount,
    rasterBlob: loaded.raster.blob,
    dims: { width: loaded.raster.width, height: loaded.raster.height },
  };
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
        const defaultId = await get().createMapFromPdf(file, {
          scale: FIXED_RENDER_SCALE,
          name: DEFAULT_MAP_NAME,
        });
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

      const mostRecentNonDefault = [...maps]
        .filter((m) => !m.isDefault)
        .sort((a, b) => {
          const aRecent = a.lastOpenedAt ?? a.updatedAt ?? a.createdAt;
          const bRecent = b.lastOpenedAt ?? b.updatedAt ?? b.createdAt;
          return bRecent - aRecent;
        })[0];
      const defaultMap = maps.find((m) => m.isDefault) ?? null;
      const preferredIds = [
        mostRecentNonDefault?.id ?? null,
        defaultMap?.id ?? null,
        ...maps.map((m) => m.id),
      ].filter((id, index, items): id is string => Boolean(id) && items.indexOf(id) === index);
      set({ maps, activeMapId: preferredIds[0] ?? null, loading: false, initialized: true });
      for (const candidateId of preferredIds) {
        const loaded = await get().setActiveMap(candidateId);
        if (loaded) return;
      }
    } catch {
      set({ maps: [], activeMapId: null, activeRasterUrl: null, loading: false, initialized: true });
      useEditorStore.getState().setWorkspace(EMPTY_WORKSPACE);
    }
  },

  setActiveMap: async (id) => {
    debugMap('set active map start', {
      requestedMapId: id,
      currentActiveMapId: get().activeMapId,
    });

    // Flush any pending workspace edits for the current map before switching.
    // The debounce subscription clears its timer when setWorkspace fires for the
    // new map, so without this the current map's unsaved edits would be lost.
    const currentId = get().activeMapId;
    if (currentId && currentId !== id) {
      const currentWorkspace = useEditorStore.getState().workspace;
      const currentMapInDb = await idb.getMap(currentId);
      if (currentMapInDb) {
        const currentMeta = getPageMeta(currentMapInDb, currentMapInDb.pageIndex);
        const flushed = withPageMeta(currentMapInDb, currentMapInDb.pageIndex, {
          ...currentMeta,
          workspace: currentWorkspace,
        });
        await idb.putMap(flushed);
        set({
          maps: get().maps.map((m) => (m.id === currentId ? flushed : m)),
        });
      }
    }

    saveActiveId(id);
    if (!id) {
      setObjectUrl(null);
      set({ activeMapId: null, activeRasterUrl: null });
      useEditorStore.getState().setWorkspace(EMPTY_WORKSPACE);
      return true;
    }
    const map = await idb.getMap(id);
    if (!map) {
      debugMap('set active map missing map record', { requestedMapId: id });
      saveActiveId(null);
      setObjectUrl(null);
      set({ activeMapId: null, activeRasterUrl: null });
      useEditorStore.getState().setWorkspace(EMPTY_WORKSPACE);
      return false;
    }
    debugMap('set active map loaded record', {
      mapId: map.id,
      name: map.name,
      pageIndex: map.pageIndex,
      pageCount: map.pageCount,
      sourceStoragePath: map.sourceStoragePath ?? null,
    });
    const loaded = await loadMapPage(id, map.pageIndex, { touchLastOpened: true });
    if (!loaded) return false;
    const pageIndex = loaded.pageIndex;
    const url = URL.createObjectURL(loaded.raster.blob);
    setObjectUrl(url);
    const synced = loaded.map;

    set({
      activeMapId: id,
      activeRasterUrl: url,
      maps: get().maps.map((m) => (m.id === id ? synced : m)),
    });
    useEditorStore.getState().setWorkspace(getPageMeta(synced, pageIndex).workspace);
    debugMap('set active map complete', {
      mapId: id,
      name: synced.name,
      pageIndex,
      width: loaded.raster.width,
      height: loaded.raster.height,
    });
    return true;
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
      const sourceBlob = await resolveSourceBlob(map);
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
    const scale = options?.scale ?? FIXED_RENDER_SCALE;
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
          ? file.name.replace(/\.(pdf|png|jpe?g|webp)$/i, '')
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
      lastOpenedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    const syncedMap = await ensureRemoteSource(map, blob);
    await idb.putMap(syncedMap);
    await idb.putPdfBlob(id, blob);
    await idb.putRaster(id, scale, 0, result.blob, result.width, result.height);

    set({ maps: [...get().maps, syncedMap] });
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
        lastOpenedAt: Date.now(),
      };
      const syncedMerged = await ensureRemoteSource(merged, sourceBlob);
      await idb.putMap(syncedMerged);
      set({
        maps: [syncedMerged, ...get().maps.filter((m) => m.id !== syncedMerged.id)],
      });
      await get().setActiveMap(syncedMerged.id);
      return syncedMerged.id;
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
      lastOpenedAt: Date.now(),
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
    const syncedMap = await ensureRemoteSource(filledMap, sourceBlob);
    await idb.putMap(syncedMap);
    await idb.putPdfBlob(filledMap.id, sourceBlob);
    await idb.putRaster(
      filledMap.id,
      filledMap.renderScale,
      filledMap.pageIndex,
      result.blob,
      result.width,
      result.height
    );
    set({ maps: [...get().maps.filter((m) => m.id !== syncedMap.id), syncedMap] });
    await get().setActiveMap(syncedMap.id);
    return syncedMap.id;
  },

  clearMapOverlays: async (id) => {
    const map = await idb.getMap(id);
    if (!map) return;
    const pageIndexes = new Set<number>([map.pageIndex]);
    for (const key of Object.keys(map.pages ?? {})) {
      pageIndexes.add(Number(key));
    }
    const clearedPages: Record<number, PageMeta> = {};
    for (const pageIndex of pageIndexes) {
      const meta = getPageMeta(map, pageIndex);
      clearedPages[pageIndex] = {
        ...meta,
        workspace: EMPTY_WORKSPACE,
      };
    }
    const activeMeta = clearedPages[map.pageIndex] ?? {
      workspace: EMPTY_WORKSPACE,
      sourceWidth: map.sourceWidth,
      sourceHeight: map.sourceHeight,
    };
    const updated: DiagramMap = {
      ...map,
      workspace: EMPTY_WORKSPACE,
      pages: clearedPages,
      sourceWidth: activeMeta.sourceWidth,
      sourceHeight: activeMeta.sourceHeight,
      updatedAt: Date.now(),
    };
    await idb.putMap(updated);
    set({
      maps: get().maps.map((entry) => (entry.id === id ? updated : entry)),
    });
    if (get().activeMapId === id) {
      useEditorStore.getState().setWorkspace(EMPTY_WORKSPACE);
    }
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
    const map = get().maps.find((m) => m.id === id);
    if (map?.isDefault) return;
    if (map?.sourceStoragePath) {
      await deleteMapSource(map.sourceStoragePath);
    }
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

  patchMapPrimitive: async (mapId, pageIndex, primitiveId, patch) => {
    const map = await idb.getMap(mapId);
    if (!map) return;
    const updated = updatePrimitiveOnPage(map, pageIndex, primitiveId, (primitive) => ({
      ...primitive,
      ...patch,
    }));
    await idb.putMap(updated);
    set({
      maps: get().maps.map((m) => (m.id === mapId ? updated : m)),
    });
    if (get().activeMapId === mapId && updated.pageIndex === pageIndex) {
      useEditorStore.getState().setWorkspace(getPageMeta(updated, pageIndex).workspace);
    }
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
