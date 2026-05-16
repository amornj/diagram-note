import { create } from 'zustand';
import type { DiagramMap, MapGroup, MapWorkspace, PageMeta, Primitive } from '../types';
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
export const DEFAULT_MAP_ID = 'map-metabolic-default';
export const FIXED_RENDER_SCALE = 1.5;
const DEFAULT_MAP_SEEDED_KEY = 'diagram-note-default-map-seeded';

function debugMap(message: string, details?: Record<string, unknown>) {
  if (details) console.info(`[map] ${message}`, details);
  else console.info(`[map] ${message}`);
}

export interface MapStoreState {
  maps: DiagramMap[];
  groups: MapGroup[];
  activeMapId: string | null;
  activeRasterUrl: string | null;
  loading: boolean;
  initialized: boolean;
  resetState: () => void;
  loadMaps: () => Promise<void>;
  createGroup: (name: string) => Promise<MapGroup | null>;
  renameGroup: (id: string, name: string) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  moveMapToGroup: (mapId: string, groupId: string | null) => Promise<void>;
  setActiveMap: (id: string | null) => Promise<boolean>;
  setActivePage: (pageIndex: number) => Promise<void>;
  createMapFromPdf: (
    file: File | Blob,
    options?: { scale?: number; name?: string; id?: string }
  ) => Promise<string>;
  importDnoteMap: (args: {
    map: DiagramMap;
    sourceBlob: Blob;
  }) => Promise<string>;
  clearMapOverlays: (id: string) => Promise<void>;
  addPrimitiveBacklink: (
    sourceMapId: string,
    sourcePageIndex: number,
    sourceId: string,
    targetMapId: string,
    targetPageIndex: number,
    targetId: string
  ) => Promise<boolean>;
  removePrimitiveBacklink: (
    sourceMapId: string,
    sourcePageIndex: number,
    sourceId: string,
    targetMapId: string,
    targetPageIndex: number,
    targetId: string
  ) => Promise<void>;
  deleteMap: (id: string) => Promise<void>;
  restoreMap: (id: string) => Promise<void>;
  permanentlyDeleteMap: (id: string) => Promise<void>;
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

function isArchivedMap(map: DiagramMap) {
  return typeof map.archivedAt === 'number';
}

function getActiveMaps(maps: DiagramMap[]) {
  return maps.filter((map) => !isArchivedMap(map));
}

function setObjectUrl(url: string | null) {
  if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
  lastObjectUrl = url;
}

function storageScopedKey(baseKey: string) {
  return `${baseKey}:${idb.getStorageNamespace()}`;
}

function saveActiveId(id: string | null) {
  if (typeof window === 'undefined') return;
  const key = storageScopedKey(ACTIVE_MAP_STORAGE_KEY);
  if (id) window.localStorage.setItem(key, id);
  else window.localStorage.removeItem(key);
}

function loadDefaultMapSeeded() {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(storageScopedKey(DEFAULT_MAP_SEEDED_KEY)) === 'true';
}

function persistDefaultMapSeeded(value: boolean) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    storageScopedKey(DEFAULT_MAP_SEEDED_KEY),
    value ? 'true' : 'false'
  );
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

async function ensureCanonicalDefaultMapId(
  maps: DiagramMap[]
): Promise<DiagramMap[]> {
  const defaultMaps = maps.filter((map) => map.isDefault);
  if (defaultMaps.length === 0) return maps;
  if (defaultMaps.some((map) => map.id === DEFAULT_MAP_ID)) return maps;

  const defaultMap = defaultMaps.reduce((best, map) =>
    map.updatedAt > best.updatedAt ? map : best
  );
  const renamed: DiagramMap = {
    ...defaultMap,
    id: DEFAULT_MAP_ID,
    sortOrder: -1,
  };
  await idb.putMap(renamed);
  await idb.deleteMap(defaultMap.id);
  return idb.listMaps();
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
  const now = Date.now();
  return withPageMeta(map, pageIndex, {
    ...meta,
    workspace: {
      ...meta.workspace,
      primitives: meta.workspace.primitives.map((primitive, index) =>
        primitive.id === primitiveId
          ? {
              ...updater(primitive),
              createdAt: primitive.createdAt ?? index,
              updatedAt: now,
            }
          : primitive
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
  groups: [],
  activeMapId: null,
  activeRasterUrl: null,
  loading: false,
  initialized: false,

  resetState: () => {
    setObjectUrl(null);
    saveActiveId(null);
    set({
      maps: [],
      groups: [],
      activeMapId: null,
      activeRasterUrl: null,
      loading: false,
      initialized: false,
    });
    useEditorStore.getState().setWorkspace(EMPTY_WORKSPACE);
  },

  createGroup: async (rawName) => {
    const name = rawName.trim();
    if (!name) return null;
    const existing = get().groups.find(
      (g) => g.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) return existing;
    const now = Date.now();
    const group: MapGroup = {
      id: `group-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      createdAt: now,
      updatedAt: now,
    };
    await idb.putGroup(group);
    set({ groups: [...get().groups, group] });
    return group;
  },

  renameGroup: async (id, rawName) => {
    const name = rawName.trim();
    if (!name) return;
    const existing = get().groups.find((g) => g.id === id);
    if (!existing) return;
    const updated: MapGroup = { ...existing, name, updatedAt: Date.now() };
    await idb.putGroup(updated);
    set({ groups: get().groups.map((g) => (g.id === id ? updated : g)) });
  },

  deleteGroup: async (id) => {
    await idb.deleteGroup(id);
    const affected = get().maps.filter((m) => m.groupId === id);
    for (const map of affected) {
      const next = { ...map, groupId: undefined, updatedAt: Date.now() };
      await idb.putMap(next);
    }
    set({
      groups: get().groups.filter((g) => g.id !== id),
      maps: get().maps.map((m) =>
        m.groupId === id ? { ...m, groupId: undefined, updatedAt: Date.now() } : m
      ),
    });
  },

  moveMapToGroup: async (mapId, groupId) => {
    const map = get().maps.find((m) => m.id === mapId);
    if (!map) return;
    if ((map.groupId ?? null) === (groupId ?? null)) return;
    const next: DiagramMap = {
      ...map,
      groupId: groupId ?? undefined,
      updatedAt: Date.now(),
    };
    await idb.putMap(next);
    set({ maps: get().maps.map((m) => (m.id === mapId ? next : m)) });
  },

  loadMaps: async () => {
    // Guard against concurrent calls (React StrictMode fires effects twice)
    if (get().loading || get().initialized) return;
    set({ loading: true });
    try {
      const groups = await idb.listGroups();
      set({ groups });
      let maps = await idb.listMaps();
      maps = await ensureCanonicalDefaultMapId(maps);

      const hasDefaultMap = maps.some((m) => m.id === DEFAULT_MAP_ID || m.isDefault);
      if (hasDefaultMap) persistDefaultMapSeeded(true);

      // Seed the bundled metabolic map only once per device.
      if (!hasDefaultMap && maps.length === 0 && !loadDefaultMapSeeded()) {
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
          id: DEFAULT_MAP_ID,
        });
        const target = await idb.getMap(defaultId);
        if (target) await idb.putMap({ ...target, isDefault: true, sortOrder: -1 });
        persistDefaultMapSeeded(true);
        maps = await idb.listMaps();
      }

      // Deduplicate: if multiple maps share the same pdfHash, keep the
      // canonical bundled metabolic map id, or else the most-recently updated one.
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
          group.find((m) => m.id === DEFAULT_MAP_ID) ??
          group.reduce((best, m) => (m.updatedAt > best.updatedAt ? m : best));
        for (const m of group) {
          if (m.id !== keep.id) dupeIdsToDelete.push(m.id);
        }
      }
      if (dupeIdsToDelete.length > 0) {
        await Promise.all(dupeIdsToDelete.map((id) => idb.deleteMap(id)));
        maps = maps.filter((m) => !dupeIdsToDelete.includes(m.id));
      }

      maps.sort((a, b) => {
        const oa = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
        const ob = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
        return oa !== ob ? oa - ob : b.updatedAt - a.updatedAt;
      });

      const availableMaps = getActiveMaps(maps);
      const mostRecent = [...availableMaps]
        .sort((a, b) => {
          const aRecent = a.lastOpenedAt ?? a.updatedAt ?? a.createdAt;
          const bRecent = b.lastOpenedAt ?? b.updatedAt ?? b.createdAt;
          return bRecent - aRecent;
        })[0];
      const preferredIds = [
        mostRecent?.id ?? null,
        ...availableMaps.map((m) => m.id),
      ].filter((id, index, items): id is string => Boolean(id) && items.indexOf(id) === index);
      set({ maps, activeMapId: preferredIds[0] ?? null, loading: false, initialized: true });
      if (preferredIds.length === 0) {
        setObjectUrl(null);
        useEditorStore.getState().setWorkspace(EMPTY_WORKSPACE);
        return;
      }
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
    if (isArchivedMap(map)) {
      debugMap('set active map rejected archived map', { requestedMapId: id });
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

    const id = options?.id ?? `map-${Math.random().toString(36).slice(2, 12)}`;
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

  addPrimitiveBacklink: async (
    sourceMapId,
    sourcePageIndex,
    sourceId,
    targetMapId,
    targetPageIndex,
    targetId
  ) => {
    if (sourceMapId === targetMapId && sourceId === targetId && sourcePageIndex === targetPageIndex) {
      return false;
    }
    const sourceMap = await idb.getMap(sourceMapId);
    const targetMap = sourceMapId === targetMapId ? sourceMap : await idb.getMap(targetMapId);
    if (!sourceMap || !targetMap) return false;

    const sourceKey = makeRelatedPrimitiveKey(sourceId, sourcePageIndex, sourceMapId);
    const targetKey = makeRelatedPrimitiveKey(targetId, targetPageIndex, targetMapId);
    const sourcePrimitive = getPageMeta(sourceMap, sourcePageIndex).workspace.primitives.find(
      (primitive) => primitive.id === sourceId
    );
    const targetPrimitive = getPageMeta(targetMap, targetPageIndex).workspace.primitives.find(
      (primitive) => primitive.id === targetId
    );
    if (!sourcePrimitive || !targetPrimitive) return false;
    const sourceHasLink = (sourcePrimitive.relatedMemberKeys ?? []).includes(targetKey);
    const targetHasLink = (targetPrimitive.relatedMemberKeys ?? []).includes(sourceKey);
    if (sourceHasLink && targetHasLink) return false;

    const nextSourceMap = updatePrimitiveOnPage(
      sourceMap,
      sourcePageIndex,
      sourceId,
      (primitive) => ({
        ...primitive,
        relatedMemberKeys: Array.from(
          new Set([...(primitive.relatedMemberKeys ?? []), targetKey])
        ).filter((key) => key !== sourceKey),
      })
    );
    const nextTargetBase = sourceMapId === targetMapId ? nextSourceMap : targetMap;
    const nextTargetMap = updatePrimitiveOnPage(
      nextTargetBase,
      targetPageIndex,
      targetId,
      (primitive) => ({
        ...primitive,
        relatedMemberKeys: Array.from(
          new Set([...(primitive.relatedMemberKeys ?? []), sourceKey])
        ).filter((key) => key !== targetKey),
      })
    );

    if (sourceMapId === targetMapId) {
      await idb.putMap(nextTargetMap);
      set({
        maps: get().maps.map((entry) => (entry.id === nextTargetMap.id ? nextTargetMap : entry)),
      });
      if (get().activeMapId === nextTargetMap.id) {
        useEditorStore
          .getState()
          .setWorkspace(getPageMeta(nextTargetMap, nextTargetMap.pageIndex).workspace, false);
      }
      return true;
    }

    await idb.putMap(nextSourceMap);
    await idb.putMap(nextTargetMap);
    set({
      maps: get().maps.map((entry) => {
        if (entry.id === nextSourceMap.id) return nextSourceMap;
        if (entry.id === nextTargetMap.id) return nextTargetMap;
        return entry;
      }),
    });
    if (get().activeMapId === nextSourceMap.id) {
      useEditorStore
        .getState()
        .setWorkspace(getPageMeta(nextSourceMap, nextSourceMap.pageIndex).workspace, false);
    } else if (get().activeMapId === nextTargetMap.id) {
      useEditorStore
        .getState()
        .setWorkspace(getPageMeta(nextTargetMap, nextTargetMap.pageIndex).workspace, false);
    }
    return true;
  },

  removePrimitiveBacklink: async (
    sourceMapId,
    sourcePageIndex,
    sourceId,
    targetMapId,
    targetPageIndex,
    targetId
  ) => {
    const sourceMap = await idb.getMap(sourceMapId);
    const targetMap = sourceMapId === targetMapId ? sourceMap : await idb.getMap(targetMapId);
    if (!sourceMap || !targetMap) return;
    const sourceKey = makeRelatedPrimitiveKey(sourceId, sourcePageIndex, sourceMapId);
    const targetKey = makeRelatedPrimitiveKey(targetId, targetPageIndex, targetMapId);
    const nextSourceMap = updatePrimitiveOnPage(sourceMap, sourcePageIndex, sourceId, (primitive) => ({
      ...primitive,
      relatedMemberKeys: (primitive.relatedMemberKeys ?? []).filter(
        (key) => key !== targetKey
      ),
    }));
    const nextTargetBase = sourceMapId === targetMapId ? nextSourceMap : targetMap;
    const nextTargetMap = updatePrimitiveOnPage(nextTargetBase, targetPageIndex, targetId, (primitive) => ({
      ...primitive,
      relatedMemberKeys: (primitive.relatedMemberKeys ?? []).filter(
        (key) => key !== sourceKey
      ),
    }));
    if (sourceMapId === targetMapId) {
      await idb.putMap(nextTargetMap);
      set({
        maps: get().maps.map((entry) => (entry.id === nextTargetMap.id ? nextTargetMap : entry)),
      });
      if (get().activeMapId === nextTargetMap.id) {
        useEditorStore
          .getState()
          .setWorkspace(getPageMeta(nextTargetMap, nextTargetMap.pageIndex).workspace, false);
      }
      return;
    }
    await idb.putMap(nextSourceMap);
    await idb.putMap(nextTargetMap);
    set({
      maps: get().maps.map((entry) => {
        if (entry.id === nextSourceMap.id) return nextSourceMap;
        if (entry.id === nextTargetMap.id) return nextTargetMap;
        return entry;
      }),
    });
    if (get().activeMapId === nextSourceMap.id) {
      useEditorStore
        .getState()
        .setWorkspace(getPageMeta(nextSourceMap, nextSourceMap.pageIndex).workspace, false);
    } else if (get().activeMapId === nextTargetMap.id) {
      useEditorStore
        .getState()
        .setWorkspace(getPageMeta(nextTargetMap, nextTargetMap.pageIndex).workspace, false);
    }
  },

  deleteMap: async (id) => {
    const map = await idb.getMap(id);
    if (!map || map.isDefault || isArchivedMap(map)) return;
    const archived: DiagramMap = {
      ...map,
      archivedAt: Date.now(),
      updatedAt: Date.now(),
    };
    await idb.putMap(archived);
    const nextMaps = get().maps.map((entry) => (entry.id === id ? archived : entry));
    set({ maps: nextMaps });
    if (get().activeMapId === id) {
      const fallbackId = getActiveMaps(nextMaps)[0]?.id ?? null;
      await get().setActiveMap(fallbackId);
    }
  },

  restoreMap: async (id) => {
    const map = await idb.getMap(id);
    if (!map || !isArchivedMap(map)) return;
    const restored: DiagramMap = {
      ...map,
      archivedAt: undefined,
      updatedAt: Date.now(),
    };
    await idb.putMap(restored);
    set({
      maps: get().maps.map((entry) => (entry.id === id ? restored : entry)),
    });
    if (!get().activeMapId) {
      await get().setActiveMap(id);
    }
  },

  permanentlyDeleteMap: async (id) => {
    const map = get().maps.find((m) => m.id === id);
    if (!map || map.isDefault) return;
    if (map.sourceStoragePath) {
      await deleteMapSource(map.sourceStoragePath);
    }
    await idb.deleteMap(id);
    const next = get().maps.filter((m) => m.id !== id);
    set({ maps: next });
    if (get().activeMapId === id) {
      const fallbackId = getActiveMaps(next)[0]?.id ?? null;
      await get().setActiveMap(fallbackId);
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
    // Skip if content is unchanged — avoids a phantom updatedAt bump when
    // setActiveMap calls setWorkspace, which would make the local snapshot
    // diverge from persistedRef and cause mergeCloudMaps to silently skip
    // incoming cross-device updates during the ~3 s debounce window.
    if (JSON.stringify(meta.workspace) === JSON.stringify(workspace)) return;
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
      useEditorStore.getState().setWorkspace(getPageMeta(updated, pageIndex).workspace, false);
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
