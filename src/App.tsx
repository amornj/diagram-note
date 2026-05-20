import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanelRightOpen, X } from 'lucide-react';
import Editor from './components/Editor';
import LeftPane from './components/LeftPane';
import Landing from './components/Landing';
import PrimitiveDetailPanel from './components/PrimitiveDetailPanel';
import ErrorBoundary from './components/ErrorBoundary';
import HotkeyHelp from './components/HotkeyHelp';
import {
  DEFAULT_OVERLAY_FILTERS,
  useEditorStore,
  type OverlayFilterState,
} from './lib/store';
import { DEFAULT_MAP_ID, loadMapPageView, useMapStore } from './lib/mapStore';
import { getPrimitiveBounds, makePrimitiveId } from './lib/workspace';
import { EMPTY_WORKSPACE } from './lib/workspace';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SyncStatusContext, type SyncStatus } from './contexts/SyncStatusContext';
import {
  deleteCloudGroup,
  deleteCloudMap,
  loadCloudGroups,
  loadCloudMaps,
  saveCloudGroup,
  saveCloudMap,
  saveCloudMaps,
  subscribeCloudGroups,
  subscribeCloudMaps,
} from './lib/cloudSync';
import { uploadMapSource } from './lib/cloudStorage';
import * as idb from './lib/idb';
import type { DiagramMap, MapGroup, MapWorkspace, Primitive } from './types';

/** Keep only one map per pdfHash — prefer isDefault, then most-recently updated. */
function dedupByHash(maps: DiagramMap[]): DiagramMap[] {
  const seen = new Map<string, DiagramMap>();
  const dupeIds = new Set<string>();
  for (const m of maps) {
    if (!m.pdfHash) continue;
    const prev = seen.get(m.pdfHash);
    if (!prev) { seen.set(m.pdfHash, m); continue; }
    const keep =
      prev.id === DEFAULT_MAP_ID
        ? prev
        : m.id === DEFAULT_MAP_ID
          ? m
          : m.updatedAt >= prev.updatedAt
            ? m
            : prev;
    dupeIds.add(keep === prev ? m.id : prev.id);
    seen.set(m.pdfHash, keep);
  }
  return dupeIds.size ? maps.filter((m) => !dupeIds.has(m.id)) : maps;
}

function snapshotMaps(maps: DiagramMap[]) {
  return new Map(maps.map((map) => [map.id, JSON.stringify(mapForCloud(map))]));
}

function snapshotMap(map: DiagramMap) {
  return JSON.stringify(mapForCloud(map));
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => stripUndefinedDeep(entry)) as T;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, stripUndefinedDeep(entry)]);
    return Object.fromEntries(entries) as T;
  }
  return value;
}

function mapForCloud(map: DiagramMap): DiagramMap {
  const { lastOpenedAt: _lastOpenedAt, ...rest } = map;
  return stripUndefinedDeep(rest);
}

function isArchivedMap(map: DiagramMap) {
  return typeof map.archivedAt === 'number';
}

function getVisibleMaps(maps: DiagramMap[]) {
  return maps.filter((map) => !isArchivedMap(map));
}

function getWorkspaceForMapPage(map: DiagramMap, pageIndex: number): MapWorkspace {
  return map.pages?.[pageIndex]?.workspace ?? map.workspace ?? EMPTY_WORKSPACE;
}

function normalizeDefaultMapIds(maps: DiagramMap[]): DiagramMap[] {
  return maps.map((map) =>
    map.isDefault && map.id !== DEFAULT_MAP_ID
      ? { ...map, id: DEFAULT_MAP_ID, sortOrder: -1 }
      : map
  );
}

function workspaceContentScore(workspace: MapWorkspace): number {
  return workspace.primitives.reduce((score, primitive) => {
    const noteCount = (primitive.notes ?? []).filter((note) => note.content.trim()).length;
    const aliasCount = primitive.aliases?.length ?? 0;
    const tagCount = primitive.tags?.length ?? 0;
    return score + 10 + noteCount * 3 + aliasCount + tagCount;
  }, 0);
}

function mapContentScore(map: DiagramMap): number {
  if (map.pages) {
    return Object.values(map.pages).reduce(
      (score, page) => score + workspaceContentScore(page.workspace),
      0
    );
  }
  return workspaceContentScore(map.workspace ?? EMPTY_WORKSPACE);
}

async function backfillCloudSourcePaths(
  uid: string,
  maps: DiagramMap[]
): Promise<DiagramMap[]> {
  let changed = false;
  const nextMaps = [...maps];
  for (let index = 0; index < nextMaps.length; index += 1) {
    const map = nextMaps[index];
    if (map.id === DEFAULT_MAP_ID || map.isDefault) continue;
    if (map.sourceStoragePath) continue;
    const sourceBlob = await idb.getPdfBlob(map.id);
    if (!sourceBlob) continue;
    let sourceStoragePath: string | null = null;
    try {
      sourceStoragePath = await uploadMapSource(
        uid,
        map.id,
        sourceBlob,
        map.sourceMimeType
      );
    } catch (error) {
      console.error('[storage] source backfill failed:', error);
    }
    if (!sourceStoragePath) continue;
    const nextMap = { ...map, sourceStoragePath, updatedAt: Date.now() };
    await idb.putMap(nextMap);
    nextMaps[index] = nextMap;
    changed = true;
  }
  if (changed) {
    useMapStore.setState((state) => ({
      maps: state.maps.map(
        (map) => nextMaps.find((entry) => entry.id === map.id) ?? map
      ),
    }));
  }
  return nextMaps;
}

async function mergeCloudMaps(
  cloud: DiagramMap[],
  previousCloudSnapshot: Map<string, string>
) {
  const localMaps = useMapStore.getState().maps;
  const cloudIds = new Set(cloud.map((map) => map.id));
  const toDelete = localMaps.filter((map) => {
    if (cloudIds.has(map.id)) return false;
    const previous = previousCloudSnapshot.get(map.id);
    if (
      map.id === DEFAULT_MAP_ID &&
      previous === undefined &&
      cloud.length > 0 &&
      mapContentScore(map) === 0
    ) {
      return true;
    }
    return previous !== undefined && previous === snapshotMap(map);
  });
  if (toDelete.length > 0) {
    await Promise.all(toDelete.map((map) => idb.deleteMap(map.id)));
  }
  const survivingLocalMaps =
    toDelete.length > 0
      ? localMaps.filter((map) => !toDelete.some((entry) => entry.id === map.id))
      : localMaps;
  const localById = new Map(survivingLocalMaps.map((m) => [m.id, m]));
  const toMerge = cloud.filter((cm) => {
    const local = localById.get(cm.id);
    if (!local) return true;
    const previous = previousCloudSnapshot.get(cm.id);
    if (previous === undefined) {
      // No prior cloud snapshot (e.g. first sync after login): accept cloud data
      // if it's newer, so cross-device changes are pulled in on login.
      if (
        cm.id === DEFAULT_MAP_ID &&
        local.id === DEFAULT_MAP_ID &&
        cm.pdfHash === local.pdfHash &&
        mapContentScore(cm) > mapContentScore(local)
      ) {
        return true;
      }
      return cm.updatedAt > local.updatedAt;
    }
    const localMatchesLastCloud = previous === snapshotMap(local);
    return localMatchesLastCloud && cm.updatedAt > local.updatedAt;
  });
  if (toMerge.length === 0 && toDelete.length === 0) return;

  for (const map of toMerge) {
    const local = localById.get(map.id);
    await idb.putMap(
      local?.lastOpenedAt !== undefined
        ? { ...map, lastOpenedAt: local.lastOpenedAt }
        : map
    );
  }
  const mergeById = new Map(
    toMerge.map((map) => {
      const local = localById.get(map.id);
      return [
        map.id,
        local?.lastOpenedAt !== undefined ? { ...map, lastOpenedAt: local.lastOpenedAt } : map,
      ];
    })
  );
  const updated = survivingLocalMaps.map((map) => mergeById.get(map.id) ?? map);
  const added = toMerge.filter((map) => !localById.has(map.id));
  useMapStore.setState(() => {
    const merged = [...updated, ...added].sort((a, b) => {
      const orderA = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return b.updatedAt - a.updatedAt;
    });
    return { maps: dedupByHash(merged) };
  });

  const afterIds = new Set(useMapStore.getState().maps.map((map) => map.id));
  const removedByDedup = [...updated, ...added].filter((map) => !afterIds.has(map.id));
  await Promise.all(removedByDedup.map((map) => idb.deleteMap(map.id)));

  const activeId = useMapStore.getState().activeMapId;
  if (activeId && !afterIds.has(activeId)) {
    const fallbackId = getVisibleMaps(useMapStore.getState().maps)[0]?.id ?? null;
    await useMapStore.getState().setActiveMap(fallbackId);
  } else if (activeId && mergeById.has(activeId)) {
    const activeMap = mergeById.get(activeId)!;
    const localActiveMap = survivingLocalMaps.find((map) => map.id === activeId) ?? null;
    const sameRenderedView =
      localActiveMap !== null &&
      localActiveMap.pageIndex === activeMap.pageIndex &&
      localActiveMap.renderScale === activeMap.renderScale &&
      localActiveMap.sourceWidth === activeMap.sourceWidth &&
      localActiveMap.sourceHeight === activeMap.sourceHeight &&
      localActiveMap.sourceStoragePath === activeMap.sourceStoragePath;

    useEditorStore
      .getState()
      .setWorkspace(getWorkspaceForMapPage(activeMap, activeMap.pageIndex), false);

    if (!sameRenderedView) {
      await useMapStore.getState().setActiveMap(activeId);
    }
  }
}

function useCloudSync(): SyncStatus {
  const maps = useMapStore((s) => s.maps);
  const groups = useMapStore((s) => s.groups);
  const { user } = useAuth();
  const syncReadyRef = useRef(false);
  const prevUidRef = useRef<string | null>(null);
  const persistedRef = useRef<Map<string, string>>(new Map());
  const persistedGroupsRef = useRef<Map<string, string>>(new Map());
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [syncReady, setSyncReady] = useState(false);

  // On login: load cloud maps and merge (newer updatedAt wins)
  useEffect(() => {
    let cancelled = false;
    if (!user) {
      prevUidRef.current = null;
      syncReadyRef.current = false;
      persistedRef.current = new Map();
      persistedGroupsRef.current = new Map();
      setSyncReady(false);
      setStatus('idle');
      return;
    }
    if (prevUidRef.current === user.uid) return;
    prevUidRef.current = user.uid;
    syncReadyRef.current = false;
    setStatus('loading');

    loadCloudMaps(user.uid).then(async (cloud) => {
      if (cancelled) return;
      if (cloud === 'error') {
        if (cancelled) return;
        syncReadyRef.current = true;
        setSyncReady(true);
        setStatus('error');
        return;
      }
      if (cloud && cloud.length > 0) {
        const normalizedCloud = dedupByHash(normalizeDefaultMapIds(cloud));
        const previous = persistedRef.current;
        await mergeCloudMaps(normalizedCloud, previous);
        if (cancelled) return;
        persistedRef.current = snapshotMaps(normalizedCloud);
      } else if (!cloud) {
        // First login — push local maps to cloud
        const localMaps = await backfillCloudSourcePaths(
          user.uid,
          useMapStore.getState().maps
        );
        if (cancelled) return;
        if (localMaps.length > 0) {
          const deduped = dedupByHash(localMaps);
          const ok = await saveCloudMaps(
            user.uid,
            deduped.map((map) => mapForCloud(map))
          );
          if (cancelled) return;
          if (ok) persistedRef.current = snapshotMaps(deduped);
        }
      }
      if (cancelled) return;
      syncReadyRef.current = true;
      setSyncReady(true);
      setStatus('synced');
    });
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  useEffect(() => {
    if (!user || !syncReady) return;
    const unsubscribe = subscribeCloudMaps(user.uid, {
      onData: (cloud) => {
        setStatus('loading');
        const nextCloud = cloud ? dedupByHash(normalizeDefaultMapIds(cloud)) : [];
        const previous = persistedRef.current;
        void mergeCloudMaps(nextCloud, previous).then(() => {
          persistedRef.current = snapshotMaps(nextCloud);
          setStatus('synced');
        });
      },
      onError: (error) => {
        console.error('[cloud] subscribe failed:', error);
        setStatus('error');
      },
    });
    return unsubscribe;
  }, [user?.uid, syncReady]);

  // On maps change: debounce-save to cloud
  useEffect(() => {
    if (!user || !syncReadyRef.current) return;
    const uid = user.uid;
    const timer = setTimeout(async () => {
      const syncedMaps = dedupByHash(await backfillCloudSourcePaths(
        uid,
        useMapStore.getState().maps
      ));
      const previous = persistedRef.current;
      const next = snapshotMaps(syncedMaps);

      const changed = syncedMaps.filter((map) => previous.get(map.id) !== next.get(map.id));
      const removed = [...previous.keys()].filter((id) => !next.has(id));
      if (changed.length === 0 && removed.length === 0) return;

      setStatus('saving');
      let ok = true;
      for (const map of changed) {
        const saved = await saveCloudMap(uid, mapForCloud(map));
        ok = ok && saved;
      }
      for (const id of removed) {
        const deleted = await deleteCloudMap(uid, id);
        ok = ok && deleted;
      }
      if (ok) {
        persistedRef.current = next;
        setStatus('synced');
      } else {
        setStatus('error');
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [user, maps]);

  // Groups: initial pull on login + push local-only groups if cloud is empty.
  useEffect(() => {
    if (!user || !syncReady) return;
    let cancelled = false;
    void (async () => {
      const cloud = await loadCloudGroups(user.uid);
      if (cancelled) return;
      if (cloud === 'error') return;
      if (cloud && cloud.length > 0) {
        await useMapStore.getState().mergeCloudGroups(cloud);
        if (cancelled) return;
        persistedGroupsRef.current = snapshotGroups(cloud);
      } else if (!cloud) {
        const localGroups = useMapStore.getState().groups;
        if (localGroups.length > 0) {
          for (const group of localGroups) {
            const saved = await saveCloudGroup(user.uid, group);
            if (cancelled) return;
            if (!saved) return;
          }
          persistedGroupsRef.current = snapshotGroups(localGroups);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, syncReady]);

  // Groups: live subscription so other devices see changes in real time.
  useEffect(() => {
    if (!user || !syncReady) return;
    const unsubscribe = subscribeCloudGroups(user.uid, {
      onData: (cloud) => {
        const next = cloud ?? [];
        void useMapStore.getState().mergeCloudGroups(next).then(() => {
          persistedGroupsRef.current = snapshotGroups(next);
        });
      },
      onError: (error) => {
        console.error('[cloud] subscribe groups failed:', error);
      },
    });
    return unsubscribe;
  }, [user?.uid, syncReady]);

  // Groups: debounce-save local changes (create/rename/delete) to cloud.
  useEffect(() => {
    if (!user || !syncReadyRef.current) return;
    const uid = user.uid;
    const timer = setTimeout(async () => {
      const localGroups = useMapStore.getState().groups;
      const previous = persistedGroupsRef.current;
      const next = snapshotGroups(localGroups);
      const changed = localGroups.filter((g) => previous.get(g.id) !== next.get(g.id));
      const removed = [...previous.keys()].filter((id) => !next.has(id));
      if (changed.length === 0 && removed.length === 0) return;
      let ok = true;
      for (const group of changed) {
        const saved = await saveCloudGroup(uid, group);
        ok = ok && saved;
      }
      for (const id of removed) {
        const deleted = await deleteCloudGroup(uid, id);
        ok = ok && deleted;
      }
      if (ok) persistedGroupsRef.current = next;
    }, 1500);
    return () => clearTimeout(timer);
  }, [user, groups]);

  return status;
}

function snapshotGroups(groups: MapGroup[]) {
  return new Map(groups.map((g) => [g.id, JSON.stringify(g)]));
}

function workspaceForPage(map: DiagramMap, pageIndex: number): MapWorkspace {
  return getWorkspaceForMapPage(map, pageIndex);
}

function ComparePane({
  mapId,
  pageIndex,
  title,
  onPageChange,
  onLoaded,
  onActivate,
  isFocusedPane,
  showAllOverlays,
  visibleOverlayFilters,
  onToggleOverlays,
  onToggleOverlayFilter,
  zoomLocked,
  onToggleZoomLock,
  panLocked,
  onTogglePanLock,
  mapOptions,
  onSelectMap,
  focusTarget,
  selectedPrimitiveId,
  onSelectPrimitive,
  onClearSelection,
  compareBacklinkPickActive,
  onStartBacklinkPick,
  onPickBacklinkTarget,
  linkFlash,
  linkConfirmIds,
}: {
  mapId: string | null;
  pageIndex: number;
  title: string;
  onPageChange: (pageIndex: number) => void;
  onLoaded: (state: {
    mapId: string | null;
    mapName: string;
    workspace: MapWorkspace | null;
  }) => void;
  onActivate: () => void;
  isFocusedPane?: boolean;
  showAllOverlays: boolean;
  visibleOverlayFilters: OverlayFilterState;
  onToggleOverlays: () => void;
  onToggleOverlayFilter: (key: keyof OverlayFilterState) => void;
  zoomLocked: boolean;
  onToggleZoomLock: () => void;
  panLocked: boolean;
  onTogglePanLock: () => void;
  mapOptions: Array<{ id: string; name: string }>;
  onSelectMap: (mapId: string) => void;
  focusTarget: { bbox: import('./types').BBox } | null;
  selectedPrimitiveId: string | null;
  onSelectPrimitive: (primitiveId: string) => void;
  onClearSelection: () => void;
  compareBacklinkPickActive: boolean;
  onStartBacklinkPick: () => void;
  onPickBacklinkTarget: (primitiveId: string) => void;
  linkFlash: { primitiveId: string; nonce: number } | null;
  linkConfirmIds: string[];
}) {
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  const [state, setState] = useState<{
    rasterUrl: string | null;
    dims: { width: number; height: number } | null;
    pageCount: number;
    pageIndex: number;
    workspace: MapWorkspace;
    mapName: string;
  }>({
    rasterUrl: null,
    dims: null,
    pageCount: 1,
    pageIndex: 0,
    workspace: EMPTY_WORKSPACE,
    mapName: title,
  });
  const storedMap = useMapStore((s) =>
    mapId ? s.maps.find((map) => map.id === mapId) ?? null : null
  );

  const patchWorkspacePrimitive = useCallback(
    (id: string, patch: Partial<import('./types').Primitive>) => {
      setState((current) => {
        const workspace = {
          ...current.workspace,
          primitives: current.workspace.primitives.map((primitive) =>
            primitive.id === id ? { ...primitive, ...patch } : primitive
          ),
        };
        onLoadedRef.current({ mapId, mapName: current.mapName, workspace });
        return { ...current, workspace };
      });
      if (mapId) {
        void useMapStore
          .getState()
          .patchMapPrimitive(mapId, pageIndex, id, patch);
      }
    },
    [mapId, pageIndex]
  );

  const onSelectPrimitiveRef = useRef(onSelectPrimitive);
  onSelectPrimitiveRef.current = onSelectPrimitive;

  const addWorkspacePrimitive = useCallback(
    (primitive: Omit<Primitive, 'id'>): string => {
      const id = makePrimitiveId();
      const now = Date.now();
      const stamped: Primitive = {
        ...primitive,
        id,
        createdAt: primitive.createdAt ?? now,
        updatedAt: now,
      };
      setState((current) => {
        const workspace = {
          ...current.workspace,
          primitives: [...current.workspace.primitives, stamped],
        };
        onLoadedRef.current({ mapId, mapName: current.mapName, workspace });
        return { ...current, workspace };
      });
      if (mapId) {
        void useMapStore.getState().addMapPrimitive(mapId, pageIndex, stamped);
      }
      onSelectPrimitiveRef.current(id);
      return id;
    },
    [mapId, pageIndex]
  );

  useEffect(() => {
    if (!storedMap || storedMap.id !== mapId) return;
    const workspace = workspaceForPage(storedMap, pageIndex);
    setState((current) => ({
      ...current,
      workspace,
      mapName: storedMap.name,
    }));
    onLoadedRef.current({ mapId: storedMap.id, mapName: storedMap.name, workspace });
  }, [storedMap, mapId, pageIndex]);

  const setAllPriorityNotesCollapsed = useCallback((collapsed: boolean) => {
    setState((current) => {
      const priorityPrimitives = current.workspace.primitives.filter(
        (primitive) =>
          primitive.showPriorityNote === true &&
          (primitive.notes ?? []).some((note) => note.isPriority && note.content.trim())
      );
      if (priorityPrimitives.length === 0) return current;
      const priorityIds = new Set(priorityPrimitives.map((primitive) => primitive.id));
      const workspace = {
        ...current.workspace,
        primitives: current.workspace.primitives.map((primitive) =>
          priorityIds.has(primitive.id)
            ? { ...primitive, priorityNoteCollapsed: collapsed }
            : primitive
        ),
      };
      onLoadedRef.current({ mapId, mapName: current.mapName, workspace });
      return { ...current, workspace };
    });
  }, [mapId]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    if (!mapId) {
      onLoadedRef.current({ mapId: null, mapName: title, workspace: null });
      setState({
        rasterUrl: null,
        dims: null,
        pageCount: 1,
        pageIndex: 0,
        workspace: EMPTY_WORKSPACE,
        mapName: title,
      });
      return;
    }
    void (async () => {
      const view = await loadMapPageView(mapId, pageIndex);
      if (!view || cancelled) return;
      objectUrl = URL.createObjectURL(view.rasterBlob);
      const workspace = workspaceForPage(view.map, view.pageIndex);
      onLoadedRef.current({ mapId: view.map.id, mapName: view.map.name, workspace });
      setState({
        rasterUrl: objectUrl,
        dims: view.dims,
        pageCount: view.pageCount,
        pageIndex: view.pageIndex,
        workspace,
        mapName: view.map.name,
      });
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mapId, pageIndex, title]);

  return (
    <div className="relative h-full w-full border-l border-white/10 first:border-l-0">
      {state.rasterUrl && state.dims ? (
        <Editor
          rasterUrl={state.rasterUrl}
          dims={state.dims}
          pageIndex={state.pageIndex}
          pageCount={state.pageCount}
          compareOnly
          title={`${title} · ${state.mapName}`}
          workspaceOverride={state.workspace}
          onComparePageChange={onPageChange}
          compareShowAllOverlays={showAllOverlays}
          compareVisibleOverlayFilters={visibleOverlayFilters}
          onToggleCompareOverlays={onToggleOverlays}
          onToggleCompareOverlayFilter={onToggleOverlayFilter}
          onSetCompareAllPriorityNotesCollapsed={setAllPriorityNotesCollapsed}
          onComparePrimitivePatch={patchWorkspacePrimitive}
          onComparePrimitiveAdd={addWorkspacePrimitive}
          compareZoomLocked={zoomLocked}
          onToggleCompareZoomLock={onToggleZoomLock}
          comparePanLocked={panLocked}
          onToggleComparePanLock={onTogglePanLock}
          mapOptions={mapOptions}
          selectedMapId={mapId}
          onSelectMap={onSelectMap}
          compareFocusTarget={focusTarget}
          onActivatePane={onActivate}
          isFocusedPane={isFocusedPane}
          selectedPrimitiveIdOverride={selectedPrimitiveId}
          onSelectPrimitiveOverride={onSelectPrimitive}
          onClearCompareSelection={onClearSelection}
          compareBacklinkPickActive={compareBacklinkPickActive}
          onStartCompareBacklinkPick={onStartBacklinkPick}
          onPickCompareBacklinkTarget={onPickBacklinkTarget}
          compareLinkFlash={linkFlash}
          compareLinkConfirmIds={linkConfirmIds}
        />
      ) : (
        <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_top,#1e293b,#020617)] text-white">
          <div className="rounded-2xl border border-white/10 bg-white/5 px-6 py-5 text-center backdrop-blur">
            <div className="text-sm font-medium tracking-wide text-white/90">
              Loading {title.toLowerCase()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MapPage() {
  const syncStatus = useCloudSync();

  const selectedPrimitiveId = useEditorStore((s) => s.selectedPrimitiveId);
  const workspace = useEditorStore((s) => s.workspace);
  const toggleRightPane = useEditorStore((s) => s.toggleRightPane);
  const rightPaneOpen = useEditorStore((s) => s.rightPaneOpen);
  const leftSidebarCollapsed = useEditorStore((s) => s.leftSidebarCollapsed);
  const setLeftSidebarCollapsed = useEditorStore((s) => s.setLeftSidebarCollapsed);
  const maps = useMapStore((s) => s.maps);
  const activeMap = useMapStore((s) => s.maps.find((m) => m.id === s.activeMapId) ?? null);
  const activeRasterUrl = useMapStore((s) => s.activeRasterUrl);
  const [showHelp, setShowHelp] = useState(false);
  const [splitMode, setSplitMode] = useState(false);
  const [splitTarget, setSplitTarget] = useState<1 | 2 | null>(null);
  const [focusedSplitPane, setFocusedSplitPane] = useState<1 | 2>(1);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [splitMaps, setSplitMaps] = useState<{
    1: { mapId: string | null; pageIndex: number };
    2: { mapId: string | null; pageIndex: number };
  }>({
    1: { mapId: activeMap?.id ?? null, pageIndex: activeMap?.pageIndex ?? 0 },
    2: { mapId: activeMap?.id ?? null, pageIndex: activeMap?.pageIndex ?? 0 },
  });
  const [compareOverlayFilters, setCompareOverlayFilters] = useState<{
    1: OverlayFilterState;
    2: OverlayFilterState;
  }>({
    1: { ...DEFAULT_OVERLAY_FILTERS },
    2: { ...DEFAULT_OVERLAY_FILTERS },
  });
  const [compareViewportLocks, setCompareViewportLocks] = useState<{
    1: { zoomLocked: boolean; panLocked: boolean };
    2: { zoomLocked: boolean; panLocked: boolean };
  }>({
    1: { zoomLocked: false, panLocked: false },
    2: { zoomLocked: false, panLocked: false },
  });
  const [comparePaneData, setComparePaneData] = useState<{
    1: { mapId: string | null; mapName: string; workspace: MapWorkspace | null };
    2: { mapId: string | null; mapName: string; workspace: MapWorkspace | null };
  }>({
    1: { mapId: activeMap?.id ?? null, mapName: activeMap?.name ?? 'Window 1', workspace: workspace },
    2: { mapId: activeMap?.id ?? null, mapName: activeMap?.name ?? 'Window 2', workspace: workspace },
  });
  const [compareSelectedPrimitiveId, setCompareSelectedPrimitiveId] = useState<{
    1: string | null;
    2: string | null;
  }>({ 1: null, 2: null });
  const [splitBacklinkPick, setSplitBacklinkPick] = useState<{
    sourcePane: 1 | 2;
    mapId: string;
    pageIndex: number;
    primitiveId: string;
  } | null>(null);
  const [compareLinkFlash, setCompareLinkFlash] = useState<{
    1: { primitiveId: string; nonce: number } | null;
    2: { primitiveId: string; nonce: number } | null;
  }>({ 1: null, 2: null });
  const [compareLinkConfirmIds, setCompareLinkConfirmIds] = useState<{
    1: string[];
    2: string[];
  }>({ 1: [], 2: [] });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;
      if (event.key === '?' && !editing) {
        event.preventDefault();
        setShowHelp((value) => !value);
      }
      if (event.key === 'Escape' && showHelp) {
        event.preventDefault();
        setShowHelp(false);
        return;
      }
      if (event.key === '|' && !editing) {
        event.preventDefault();
        toggleSplitModeRef.current();
        return;
      }
      if (event.key === 'Escape' && !editing && (!leftSidebarCollapsed || rightPaneOpen)) {
        event.preventDefault();
        if (!leftSidebarCollapsed) setLeftSidebarCollapsed(true);
        if (rightPaneOpen) toggleRightPane();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    showHelp,
    leftSidebarCollapsed,
    rightPaneOpen,
    setLeftSidebarCollapsed,
    toggleRightPane,
    splitMode,
  ]);

  useEffect(() => {
    if (splitMode || !activeMap) return;
    setSplitMaps({
      1: { mapId: activeMap.id, pageIndex: activeMap.pageIndex },
      2: { mapId: activeMap.id, pageIndex: activeMap.pageIndex },
    });
    setComparePaneData({
      1: { mapId: activeMap.id, mapName: activeMap.name, workspace },
      2: { mapId: activeMap.id, mapName: activeMap.name, workspace },
    });
  }, [activeMap?.id, activeMap?.pageIndex, splitMode]);

  useEffect(() => {
    const timers = ([
      1,
      2,
    ] as const)
      .map((pane) => {
        const flash = compareLinkFlash[pane];
        if (!flash) return null;
        return window.setTimeout(() => {
          setCompareLinkFlash((current) => ({ ...current, [pane]: null }));
        }, 700);
      })
      .filter((timer): timer is number => timer !== null);
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [compareLinkFlash]);

  const [leftPaneWidth, setLeftPaneWidth] = useState(() => {
    if (typeof window === 'undefined') return 280;
    const raw = window.localStorage.getItem('diagram-note-left-pane-width');
    const parsed = raw ? Number(raw) : 280;
    return Number.isFinite(parsed) ? Math.min(520, Math.max(240, parsed)) : 280;
  });
  const [rightPaneWidth, setRightPaneWidth] = useState(() => {
    if (typeof window === 'undefined') return 360;
    const raw = window.localStorage.getItem('diagram-note-right-pane-width');
    const parsed = raw ? Number(raw) : 360;
    return Number.isFinite(parsed) ? Math.min(640, Math.max(300, parsed)) : 360;
  });

  const selectedPrimitive = useMemo(() => {
    if (!selectedPrimitiveId) return null;
    return workspace.primitives.find((p) => p.id === selectedPrimitiveId) ?? null;
  }, [selectedPrimitiveId, workspace.primitives]);

  const selectedComparePrimitive = useMemo(() => {
    if (!splitMode) return null;
    const primitiveId = compareSelectedPrimitiveId[focusedSplitPane];
    const paneWorkspace = comparePaneData[focusedSplitPane].workspace;
    if (!primitiveId || !paneWorkspace) return null;
    return paneWorkspace.primitives.find((primitive) => primitive.id === primitiveId) ?? null;
  }, [splitMode, compareSelectedPrimitiveId, focusedSplitPane, comparePaneData]);

  // Only refit the compare viewport when the selection identity (map/page/primitive)
  // changes — not on every workspace mutation. Otherwise editing a primitive's
  // name or notes would yank the user's zoomed-in view back to fit the bbox.
  const [compareFocusTarget1, setCompareFocusTarget1] = useState<{ bbox: import('./types').BBox } | null>(null);
  const [compareFocusTarget2, setCompareFocusTarget2] = useState<{ bbox: import('./types').BBox } | null>(null);
  const lastCompareFocusKey1 = useRef<string | null>(null);
  const lastCompareFocusKey2 = useRef<string | null>(null);

  useEffect(() => {
    const id = compareSelectedPrimitiveId[1];
    const mapId = splitMaps[1].mapId;
    const pageIndex = splitMaps[1].pageIndex;
    const ws = comparePaneData[1].workspace;
    if (!id || !mapId || !ws) {
      if (lastCompareFocusKey1.current !== null) {
        lastCompareFocusKey1.current = null;
        setCompareFocusTarget1(null);
      }
      return;
    }
    const key = `${mapId}:${pageIndex}:${id}`;
    if (key === lastCompareFocusKey1.current) return;
    const primitivesById = new Map(ws.primitives.map((primitive) => [primitive.id, primitive]));
    const primitive = primitivesById.get(id);
    if (!primitive) return;
    const bbox = getPrimitiveBounds(primitive, primitivesById);
    if (!bbox) return;
    lastCompareFocusKey1.current = key;
    setCompareFocusTarget1({ bbox });
  }, [comparePaneData, compareSelectedPrimitiveId, splitMaps]);

  useEffect(() => {
    const id = compareSelectedPrimitiveId[2];
    const mapId = splitMaps[2].mapId;
    const pageIndex = splitMaps[2].pageIndex;
    const ws = comparePaneData[2].workspace;
    if (!id || !mapId || !ws) {
      if (lastCompareFocusKey2.current !== null) {
        lastCompareFocusKey2.current = null;
        setCompareFocusTarget2(null);
      }
      return;
    }
    const key = `${mapId}:${pageIndex}:${id}`;
    if (key === lastCompareFocusKey2.current) return;
    const primitivesById = new Map(ws.primitives.map((primitive) => [primitive.id, primitive]));
    const primitive = primitivesById.get(id);
    if (!primitive) return;
    const bbox = getPrimitiveBounds(primitive, primitivesById);
    if (!bbox) return;
    lastCompareFocusKey2.current = key;
    setCompareFocusTarget2({ bbox });
  }, [comparePaneData, compareSelectedPrimitiveId, splitMaps]);

  const mapOptions = useMemo(
    () =>
      [...getVisibleMaps(maps)]
        .sort((a, b) => {
          const aRecent = a.lastOpenedAt ?? a.updatedAt ?? a.createdAt;
          const bRecent = b.lastOpenedAt ?? b.updatedAt ?? b.createdAt;
          return bRecent - aRecent;
        })
        .map((map) => ({ id: map.id, name: map.name })),
    [maps]
  );

  useEffect(() => {
    window.localStorage.setItem('diagram-note-left-pane-width', String(leftPaneWidth));
  }, [leftPaneWidth]);

  useEffect(() => {
    window.localStorage.setItem('diagram-note-right-pane-width', String(rightPaneWidth));
  }, [rightPaneWidth]);

  const startResize = (startX: number, startWidth: number) => {
    const handleMove = (event: MouseEvent) => {
      const next = startWidth + (startX - event.clientX);
      setRightPaneWidth(Math.min(640, Math.max(300, next)));
    };
    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  const startLeftResize = (startX: number, startWidth: number) => {
    const handleMove = (event: MouseEvent) => {
      const next = startWidth + (event.clientX - startX);
      setLeftPaneWidth(Math.min(520, Math.max(240, next)));
    };
    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  const toggleSplitMode = () => {
    setSplitMode((current) => {
      const next = !current;
      if (next && activeMap) {
        useEditorStore.getState().setSelectedPrimitiveId(null);
        setSplitRatio(0.5);
        setFocusedSplitPane(1);
        setSplitTarget(null);
        setSplitBacklinkPick(null);
        setCompareOverlayFilters({
          1: { ...DEFAULT_OVERLAY_FILTERS },
          2: { ...DEFAULT_OVERLAY_FILTERS },
        });
        setCompareViewportLocks({
          1: { zoomLocked: false, panLocked: false },
          2: { zoomLocked: false, panLocked: false },
        });
        setCompareSelectedPrimitiveId({ 1: null, 2: null });
        setSplitMaps({
          1: { mapId: activeMap.id, pageIndex: activeMap.pageIndex },
          2: { mapId: activeMap.id, pageIndex: activeMap.pageIndex },
        });
        setComparePaneData({
          1: { mapId: activeMap.id, mapName: activeMap.name, workspace },
          2: { mapId: activeMap.id, mapName: activeMap.name, workspace },
        });
      } else if (!next) {
        setSplitTarget(null);
        setSplitBacklinkPick(null);
      }
      return next;
    });
  };
  const toggleSplitModeRef = useRef(toggleSplitMode);
  toggleSplitModeRef.current = toggleSplitMode;

  const assignSplitMapToPane = (pane: 1 | 2, mapId: string) => {
    const map = useMapStore.getState().maps.find((entry) => entry.id === mapId);
    setFocusedSplitPane(pane);
    setSplitTarget(null);
    setSplitBacklinkPick(null);
    setCompareSelectedPrimitiveId((current) => ({ ...current, [pane]: null }));
    setSplitMaps((current) => ({
      ...current,
      [pane]: {
        mapId,
        pageIndex: map?.pageIndex ?? 0,
      },
    }));
  };

  const openMapInSplit = (
    mapId: string,
    options?: { pageIndex?: number; primitiveId?: string | null }
  ) => {
    if (!activeMap) return;
    const target = useMapStore.getState().maps.find((entry) => entry.id === mapId);
    if (!target) return;
    const pageIndex = options?.pageIndex ?? target.pageIndex;
    const primitiveId = options?.primitiveId ?? null;
    if (splitMode) {
      setFocusedSplitPane(2);
      setSplitTarget(null);
      setSplitBacklinkPick(null);
      setSplitMaps((current) => ({ ...current, 2: { mapId, pageIndex } }));
      setCompareSelectedPrimitiveId((current) => ({ ...current, 2: primitiveId }));
      return;
    }
    useEditorStore.getState().setSelectedPrimitiveId(null);
    setSplitRatio(0.5);
    setFocusedSplitPane(2);
    setSplitTarget(null);
    setSplitBacklinkPick(null);
    setCompareOverlayFilters({
      1: { ...DEFAULT_OVERLAY_FILTERS },
      2: { ...DEFAULT_OVERLAY_FILTERS },
    });
    setCompareViewportLocks({
      1: { zoomLocked: false, panLocked: false },
      2: { zoomLocked: false, panLocked: false },
    });
    setCompareSelectedPrimitiveId({ 1: null, 2: primitiveId });
    setSplitMaps({
      1: { mapId: activeMap.id, pageIndex: activeMap.pageIndex },
      2: { mapId: target.id, pageIndex },
    });
    setComparePaneData({
      1: { mapId: activeMap.id, mapName: activeMap.name, workspace },
      2: {
        mapId: target.id,
        mapName: target.name,
        workspace: target.id === activeMap.id ? workspace : null,
      },
    });
    setSplitMode(true);
  };

  useEffect(() => {
    const handleOpenInSplit = (event: Event) => {
      const detail = (event as CustomEvent<{
        mapId: string;
        pageIndex?: number;
        primitiveId?: string | null;
      }>).detail;
      if (!detail || !detail.mapId) return;
      openMapInSplit(detail.mapId, {
        pageIndex: detail.pageIndex,
        primitiveId: detail.primitiveId ?? null,
      });
    };
    window.addEventListener('map-open-in-split', handleOpenInSplit);
    return () => window.removeEventListener('map-open-in-split', handleOpenInSplit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMap, splitMode, workspace]);

  const handleCompareLoaded1 = useCallback((state: {
    mapId: string | null;
    mapName: string;
    workspace: MapWorkspace | null;
  }) => {
    setComparePaneData((current) => ({ ...current, 1: state }));
  }, []);

  const handleCompareLoaded2 = useCallback((state: {
    mapId: string | null;
    mapName: string;
    workspace: MapWorkspace | null;
  }) => {
    setComparePaneData((current) => ({ ...current, 2: state }));
  }, []);

  const handleActivatePane1 = useCallback(() => {
    setFocusedSplitPane(1);
  }, []);

  const handleActivatePane2 = useCallback(() => {
    setFocusedSplitPane(2);
  }, []);

  const clearSplitLinkConfirmations = useCallback(() => {
    setCompareLinkConfirmIds({ 1: [], 2: [] });
  }, []);

  const selectSplitPrimitive = useCallback((pane: 1 | 2, primitiveId: string) => {
    setFocusedSplitPane(pane);
    useEditorStore.setState({ rightPaneOpen: true });
    setCompareSelectedPrimitiveId((current) => ({
      ...current,
      [pane]: primitiveId,
    }));
    setCompareLinkConfirmIds((current) => {
      const allConfirmed = new Set([...current[1], ...current[2]]);
      return allConfirmed.has(primitiveId) ? current : { 1: [], 2: [] };
    });
  }, []);

  const startSplitBacklinkPick = useCallback((pane: 1 | 2) => {
    const primitiveId = compareSelectedPrimitiveId[pane];
    const mapId = splitMaps[pane].mapId;
    if (!primitiveId || !mapId) return;
    const pageIndex = splitMaps[pane].pageIndex;
    setFocusedSplitPane(pane);
    setSplitBacklinkPick((current) => {
      if (
        current?.sourcePane === pane &&
        current.mapId === mapId &&
        current.pageIndex === pageIndex &&
        current.primitiveId === primitiveId
      ) {
        return null;
      }
      return { sourcePane: pane, mapId, pageIndex, primitiveId };
    });
  }, [compareSelectedPrimitiveId, splitMaps]);

  const handleSplitBacklinkTarget = useCallback(
    async (pane: 1 | 2, primitiveId: string) => {
      if (!splitBacklinkPick) return;
      const targetMapId = splitMaps[pane].mapId;
      if (!targetMapId) return;
      const added = await useMapStore.getState().addPrimitiveBacklink(
        splitBacklinkPick.mapId,
        splitBacklinkPick.pageIndex,
        splitBacklinkPick.primitiveId,
        targetMapId,
        splitMaps[pane].pageIndex,
        primitiveId
      );
      if (!added) return;
      setCompareLinkFlash((current) => ({
        ...current,
        [pane]: { primitiveId, nonce: Date.now() },
      }));
      setCompareLinkConfirmIds((current) => ({
        ...current,
        [splitBacklinkPick.sourcePane]: [splitBacklinkPick.primitiveId],
        [pane]: splitBacklinkPick.sourcePane === pane ? [splitBacklinkPick.primitiveId, primitiveId] : [primitiveId],
      }));
      setSplitBacklinkPick(null);
      setFocusedSplitPane(splitBacklinkPick.sourcePane);
    },
    [splitBacklinkPick, splitMaps]
  );

  const patchFocusedSplitPrimitive = useCallback(
    (primitiveId: string, patch: Partial<Primitive>) => {
      const pane = focusedSplitPane;
      const mapId = splitMaps[pane].mapId;
      const pageIndex = splitMaps[pane].pageIndex;
      if (!mapId) return;
      setComparePaneData((current) => {
        const paneData = current[pane];
        if (!paneData.workspace) return current;
        return {
          ...current,
          [pane]: {
            ...paneData,
            workspace: {
              ...paneData.workspace,
              primitives: paneData.workspace.primitives.map((primitive) =>
                primitive.id === primitiveId
                  ? { ...primitive, ...patch, updatedAt: Date.now() }
                  : primitive
              ),
            },
          },
        };
      });
      void useMapStore.getState().patchMapPrimitive(mapId, pageIndex, primitiveId, patch);
    },
    [focusedSplitPane, splitMaps]
  );

  const deleteFocusedSplitPrimitive = useCallback(
    (primitiveId: string) => {
      const pane = focusedSplitPane;
      const mapId = splitMaps[pane].mapId;
      const pageIndex = splitMaps[pane].pageIndex;
      if (!mapId) return;
      setComparePaneData((current) => {
        const paneData = current[pane];
        if (!paneData.workspace) return current;
        return {
          ...current,
          [pane]: {
            ...paneData,
            workspace: {
              ...paneData.workspace,
              primitives: paneData.workspace.primitives.filter(
                (primitive) => primitive.id !== primitiveId
              ),
            },
          },
        };
      });
      setCompareSelectedPrimitiveId((current) => ({ ...current, [pane]: null }));
      void useMapStore.getState().deleteMapPrimitive(mapId, pageIndex, primitiveId);
    },
    [focusedSplitPane, splitMaps]
  );

  const openCrossMapBacklink = useCallback(
    ({
      sourceMapId,
      sourcePageIndex,
      sourcePrimitiveId,
      targetMapId,
      targetPageIndex,
      targetPrimitiveId,
    }: {
      sourceMapId: string;
      sourcePageIndex: number;
      sourcePrimitiveId: string;
      targetMapId: string;
      targetPageIndex: number;
      targetPrimitiveId: string;
    }) => {
      const sourceMap = maps.find((map) => map.id === sourceMapId);
      const targetMap = maps.find((map) => map.id === targetMapId);
      if (!sourceMap || !targetMap) return;
      setSplitMode(true);
      setSplitTarget(null);
      setFocusedSplitPane(2);
      setSplitBacklinkPick(null);
      setSplitRatio(0.5);
      setSplitMaps({
        1: { mapId: sourceMapId, pageIndex: sourcePageIndex },
        2: { mapId: targetMapId, pageIndex: targetPageIndex },
      });
      setComparePaneData({
        1: {
          mapId: sourceMapId,
          mapName: sourceMap.name,
          workspace:
            activeMap?.id === sourceMapId && activeMap.pageIndex === sourcePageIndex
              ? workspace
              : workspaceForPage(sourceMap, sourcePageIndex),
        },
        2: {
          mapId: targetMapId,
          mapName: targetMap.name,
          workspace: workspaceForPage(targetMap, targetPageIndex),
        },
      });
      setCompareSelectedPrimitiveId({
        1: sourcePrimitiveId,
        2: targetPrimitiveId,
      });
    },
    [maps, activeMap, workspace]
  );

  const openSplitBacklink = useCallback(
    async ({
      targetMapId,
      targetPageIndex,
      targetPrimitiveId,
      openInSplit: shouldOpenInSplit,
    }: {
      targetMapId: string;
      targetPageIndex: number;
      targetPrimitiveId: string;
      openInSplit: boolean;
    }) => {
      const targetMap = maps.find((map) => map.id === targetMapId);
      if (!targetMap) return;
      if (shouldOpenInSplit) {
        const targetPane: 1 | 2 = focusedSplitPane === 1 ? 2 : 1;
        setSplitTarget(null);
        setSplitBacklinkPick(null);
        setFocusedSplitPane(targetPane);
        setSplitMaps((current) => ({
          ...current,
          [targetPane]: { mapId: targetMapId, pageIndex: targetPageIndex },
        }));
        setComparePaneData((current) => ({
          ...current,
          [targetPane]: {
            mapId: targetMapId,
            mapName: targetMap.name,
            workspace:
              activeMap?.id === targetMapId && activeMap.pageIndex === targetPageIndex
                ? workspace
                : workspaceForPage(targetMap, targetPageIndex),
          },
        }));
        setCompareSelectedPrimitiveId((current) => ({
          ...current,
          [targetPane]: targetPrimitiveId,
        }));
        useEditorStore.setState({ rightPaneOpen: true });
        return;
      }

      setSplitMode(false);
      setSplitTarget(null);
      setSplitBacklinkPick(null);
      const opened = await useMapStore.getState().setActiveMap(targetMapId);
      if (!opened) return;
      await useMapStore.getState().setActivePage(targetPageIndex);
      useEditorStore.getState().setSelectedPrimitiveId(targetPrimitiveId);
    },
    [activeMap, focusedSplitPane, maps, workspace]
  );

  const handleToggleCompareOverlays1 = useCallback(() => {
    setCompareOverlayFilters((current) => {
      const allVisible = Object.values(current[1]).every(Boolean);
      return {
        ...current,
        1: {
          studyBox: !allVisible,
          group: !allVisible,
          region: !allVisible,
          priorityNote: !allVisible,
        },
      };
    });
  }, []);

  const handleToggleCompareOverlays2 = useCallback(() => {
    setCompareOverlayFilters((current) => {
      const allVisible = Object.values(current[2]).every(Boolean);
      return {
        ...current,
        2: {
          studyBox: !allVisible,
          group: !allVisible,
          region: !allVisible,
          priorityNote: !allVisible,
        },
      };
    });
  }, []);

  const handleToggleCompareOverlayFilter1 = useCallback(
    (key: keyof OverlayFilterState) => {
      setCompareOverlayFilters((current) => ({
        ...current,
        1: {
          ...current[1],
          [key]: !current[1][key],
        },
      }));
    },
    []
  );

  const handleToggleCompareOverlayFilter2 = useCallback(
    (key: keyof OverlayFilterState) => {
      setCompareOverlayFilters((current) => ({
        ...current,
        2: {
          ...current[2],
          [key]: !current[2][key],
        },
      }));
    },
    []
  );

  const handleToggleCompareZoomLock1 = useCallback(() => {
    setCompareViewportLocks((current) => ({
      ...current,
      1: { ...current[1], zoomLocked: !current[1].zoomLocked },
    }));
  }, []);

  const handleToggleCompareZoomLock2 = useCallback(() => {
    setCompareViewportLocks((current) => ({
      ...current,
      2: { ...current[2], zoomLocked: !current[2].zoomLocked },
    }));
  }, []);

  const handleToggleComparePanLock1 = useCallback(() => {
    setCompareViewportLocks((current) => ({
      ...current,
      1: { ...current[1], panLocked: !current[1].panLocked },
    }));
  }, []);

  const handleToggleComparePanLock2 = useCallback(() => {
    setCompareViewportLocks((current) => ({
      ...current,
      2: { ...current[2], panLocked: !current[2].panLocked },
    }));
  }, []);

  const handleSelectCompareMap1 = useCallback((mapId: string) => {
    assignSplitMapToPane(1, mapId);
  }, []);

  const handleSelectCompareMap2 = useCallback((mapId: string) => {
    assignSplitMapToPane(2, mapId);
  }, []);

  const handleComparePageChange1 = useCallback((page: number) => {
    setSplitMaps((current) => ({
      ...current,
      1: { ...current[1], pageIndex: page },
    }));
  }, []);

  const handleComparePageChange2 = useCallback((page: number) => {
    setSplitMaps((current) => ({
      ...current,
      2: { ...current[2], pageIndex: page },
    }));
  }, []);

  const startSplitResize = (startX: number, startRatio: number) => {
    const handleMove = (event: MouseEvent) => {
      const width = window.innerWidth || 1;
      const deltaRatio = (event.clientX - startX) / width;
      setSplitRatio(Math.min(0.8, Math.max(0.2, startRatio + deltaRatio)));
    };
    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  if (maps.length === 0) {
    return (
      <SyncStatusContext.Provider value={syncStatus}>
        <Landing />
      </SyncStatusContext.Provider>
    );
  }

  if (!activeMap || !activeRasterUrl) {
    return (
      <SyncStatusContext.Provider value={syncStatus}>
        <div className="relative h-screen w-screen overflow-hidden bg-gray-50">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="rounded-2xl border border-gray-200 bg-white px-6 py-5 text-center shadow-sm">
              <div className="text-sm font-semibold text-gray-900">No active map</div>
              <div className="mt-1 text-sm text-gray-500">
                Restore a map from Archive or load a new one from the menu.
              </div>
            </div>
          </div>
          <div className="pointer-events-none absolute inset-y-0 left-0 z-30">
            <div className="pointer-events-auto relative h-full">
              <LeftPane />
            </div>
          </div>
        </div>
      </SyncStatusContext.Provider>
    );
  }

  const dims = { width: activeMap.sourceWidth, height: activeMap.sourceHeight };

  return (
    <SyncStatusContext.Provider value={syncStatus}>
      <div className="relative h-screen w-screen overflow-hidden bg-gray-50">
        <div className="absolute inset-0">
          {splitMode ? (
            <div className="relative flex h-full w-full">
              <div className="relative h-full" style={{ width: `${splitRatio * 100}%` }}>
              <ComparePane
                mapId={splitMaps[1].mapId}
                pageIndex={splitMaps[1].pageIndex}
                title="Window 1"
                onLoaded={handleCompareLoaded1}
                onActivate={handleActivatePane1}
                isFocusedPane={focusedSplitPane === 1}
                showAllOverlays={Object.values(compareOverlayFilters[1]).every(Boolean)}
                visibleOverlayFilters={compareOverlayFilters[1]}
                onToggleOverlays={handleToggleCompareOverlays1}
                onToggleOverlayFilter={handleToggleCompareOverlayFilter1}
                zoomLocked={compareViewportLocks[1].zoomLocked}
                onToggleZoomLock={handleToggleCompareZoomLock1}
                panLocked={compareViewportLocks[1].panLocked}
                onTogglePanLock={handleToggleComparePanLock1}
                mapOptions={mapOptions}
                onSelectMap={handleSelectCompareMap1}
                focusTarget={compareFocusTarget1}
                onPageChange={handleComparePageChange1}
                selectedPrimitiveId={compareSelectedPrimitiveId[1]}
                onSelectPrimitive={(primitiveId) => selectSplitPrimitive(1, primitiveId)}
                onClearSelection={clearSplitLinkConfirmations}
                compareBacklinkPickActive={splitBacklinkPick !== null && splitBacklinkPick.sourcePane !== 1}
                onStartBacklinkPick={() => startSplitBacklinkPick(1)}
                onPickBacklinkTarget={(primitiveId) => {
                  void handleSplitBacklinkTarget(1, primitiveId);
                }}
                linkFlash={compareLinkFlash[1]}
                linkConfirmIds={compareLinkConfirmIds[1]}
              />
                <button
                  onClick={() => {
                    const otherPaneMapId = splitMaps[2].mapId;
                    const primitiveToSelect = compareSelectedPrimitiveId[2];
                    setSplitMode(false);
                    if (otherPaneMapId) {
                      void useMapStore.getState().setActiveMap(otherPaneMapId).then(() => {
                        if (primitiveToSelect) {
                          useEditorStore.getState().setSelectedPrimitiveId(primitiveToSelect);
                        }
                      });
                    }
                  }}
                  className="absolute bottom-4 right-4 z-30 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white/90 shadow transition hover:bg-black/80"
                  title="Close split compare"
                >
                  <X size={14} />
                </button>
              </div>
              <div
                className="relative z-20 w-2 shrink-0 cursor-col-resize bg-transparent"
                onMouseDown={(event) => {
                  event.preventDefault();
                  startSplitResize(event.clientX, splitRatio);
                }}
              >
                <div className="absolute bottom-0 left-1/2 top-0 w-px -translate-x-1/2 bg-slate-900/70" />
                <div className="absolute left-1/2 top-1/2 h-20 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-800/85 shadow" />
              </div>
              <div className="relative h-full flex-1">
              <ComparePane
                mapId={splitMaps[2].mapId}
                pageIndex={splitMaps[2].pageIndex}
                title="Window 2"
                onLoaded={handleCompareLoaded2}
                onActivate={handleActivatePane2}
                isFocusedPane={focusedSplitPane === 2}
                showAllOverlays={Object.values(compareOverlayFilters[2]).every(Boolean)}
                visibleOverlayFilters={compareOverlayFilters[2]}
                onToggleOverlays={handleToggleCompareOverlays2}
                onToggleOverlayFilter={handleToggleCompareOverlayFilter2}
                zoomLocked={compareViewportLocks[2].zoomLocked}
                onToggleZoomLock={handleToggleCompareZoomLock2}
                panLocked={compareViewportLocks[2].panLocked}
                onTogglePanLock={handleToggleComparePanLock2}
                mapOptions={mapOptions}
                onSelectMap={handleSelectCompareMap2}
                focusTarget={compareFocusTarget2}
                onPageChange={handleComparePageChange2}
                selectedPrimitiveId={compareSelectedPrimitiveId[2]}
                onSelectPrimitive={(primitiveId) => selectSplitPrimitive(2, primitiveId)}
                onClearSelection={clearSplitLinkConfirmations}
                compareBacklinkPickActive={splitBacklinkPick !== null && splitBacklinkPick.sourcePane !== 2}
                onStartBacklinkPick={() => startSplitBacklinkPick(2)}
                onPickBacklinkTarget={(primitiveId) => {
                  void handleSplitBacklinkTarget(2, primitiveId);
                }}
                linkFlash={compareLinkFlash[2]}
                linkConfirmIds={compareLinkConfirmIds[2]}
              />
                <button
                  onClick={() => {
                    const otherPaneMapId = splitMaps[1].mapId;
                    const primitiveToSelect = compareSelectedPrimitiveId[1];
                    setSplitMode(false);
                    if (otherPaneMapId) {
                      void useMapStore.getState().setActiveMap(otherPaneMapId).then(() => {
                        if (primitiveToSelect) {
                          useEditorStore.getState().setSelectedPrimitiveId(primitiveToSelect);
                        }
                      });
                    }
                  }}
                  className="absolute bottom-4 right-4 z-30 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white/90 shadow transition hover:bg-black/80"
                  title="Close split compare"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ) : (
            <Editor
              rasterUrl={activeRasterUrl}
              dims={dims}
              pageIndex={activeMap.pageIndex}
              pageCount={activeMap.pageCount}
              leftInset={leftSidebarCollapsed ? 0 : leftPaneWidth}
              splitMode={splitMode}
              onToggleSplitMode={toggleSplitMode}
              mapOptions={[...getVisibleMaps(maps)]
                .sort((a, b) => {
                  const aRecent = a.lastOpenedAt ?? a.updatedAt ?? a.createdAt;
                  const bRecent = b.lastOpenedAt ?? b.updatedAt ?? b.createdAt;
                  return bRecent - aRecent;
                })
                .map((map) => ({ id: map.id, name: map.name }))}
              selectedMapId={activeMap.id}
              onSelectMap={(mapId) => {
                void useMapStore.getState().setActiveMap(mapId);
              }}
              onOpenMapInSplit={openMapInSplit}
            />
          )}
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-0 z-30">
          <div
            className="pointer-events-auto relative h-full"
            style={{ width: leftSidebarCollapsed ? undefined : leftPaneWidth }}
          >
            <LeftPane
              splitMode={splitMode}
              splitAssignments={{
                1: splitMaps[1].mapId,
                2: splitMaps[2].mapId,
              }}
              splitTarget={splitTarget}
              onSetSplitTarget={setSplitTarget}
              onAssignMapToSplitPane={assignSplitMapToPane}
              onOpenMapInSplit={openMapInSplit}
              workspaceOverride={splitMode ? comparePaneData[focusedSplitPane].workspace : undefined}
              selectedPrimitiveIdOverride={splitMode ? compareSelectedPrimitiveId[focusedSplitPane] : undefined}
              onSelectPrimitiveOverride={
                splitMode
                  ? (primitiveId) => selectSplitPrimitive(focusedSplitPane, primitiveId)
                  : undefined
              }
              paneLabel={
                splitMode
                  ? `W${focusedSplitPane}`
                  : undefined
              }
            />
            {!leftSidebarCollapsed && (
              <div
                className="absolute inset-y-0 right-0 hidden w-2 cursor-col-resize lg:block"
                onMouseDown={(event) => {
                  event.preventDefault();
                  startLeftResize(event.clientX, leftPaneWidth);
                }}
              >
                <div className="absolute inset-y-0 right-0 w-px bg-gray-200" />
                <div className="absolute right-0 top-1/2 h-16 w-1 translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-300" />
              </div>
            )}
          </div>
        </div>

        {splitMode && selectedComparePrimitive && !rightPaneOpen && (
          <button
            onClick={toggleRightPane}
            className="fixed right-0 top-1/2 z-40 -translate-y-1/2 rounded-l-xl border border-gray-200 bg-white px-2 py-4 shadow-md transition hover:bg-gray-50"
            title={`Open window ${focusedSplitPane} detail pane (2)`}
          >
            <PanelRightOpen size={18} className="text-gray-600" />
          </button>
        )}

        {splitMode && selectedComparePrimitive && rightPaneOpen && (
          <>
            <button
              onClick={toggleRightPane}
              className="fixed inset-0 z-20 bg-slate-950/30 lg:hidden"
              aria-label="Hide right pane"
            />
            <div
              className="fixed inset-x-0 bottom-0 z-30 h-[58vh] rounded-t-2xl bg-white shadow-2xl lg:absolute lg:inset-y-0 lg:right-0 lg:left-auto lg:h-full lg:rounded-none lg:shadow-none"
              style={{ width: rightPaneWidth }}
            >
              <div
                className="absolute inset-y-0 left-0 hidden w-2 cursor-col-resize lg:block"
                onMouseDown={(event) => {
                  event.preventDefault();
                  startResize(event.clientX, rightPaneWidth);
                }}
              >
                <div className="absolute inset-y-0 left-0 w-px bg-gray-200" />
                <div className="absolute left-0 top-1/2 h-16 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-300" />
              </div>
              <PrimitiveDetailPanel
                primitive={selectedComparePrimitive}
                workspaceOverride={comparePaneData[focusedSplitPane].workspace}
                mapIdOverride={splitMaps[focusedSplitPane].mapId}
                pageIndexOverride={splitMaps[focusedSplitPane].pageIndex}
                onSelectPrimitiveOverride={(primitiveId) =>
                  selectSplitPrimitive(focusedSplitPane, primitiveId)
                }
                onPatchPrimitive={patchFocusedSplitPrimitive}
                onDeletePrimitive={deleteFocusedSplitPrimitive}
                onStartCrossPaneBacklinkPick={() => startSplitBacklinkPick(focusedSplitPane)}
                onOpenBacklink={openSplitBacklink}
                paneLabel={`W${focusedSplitPane}`}
                crossPaneBacklinkPickActive={
                  splitBacklinkPick?.sourcePane === focusedSplitPane &&
                  splitBacklinkPick.primitiveId === selectedComparePrimitive.id
                }
                onOpenCrossMapBacklink={openCrossMapBacklink}
              />
            </div>
          </>
        )}

        {!splitMode && selectedPrimitive && !rightPaneOpen && (
          <button
            onClick={toggleRightPane}
            className="fixed right-0 top-1/2 z-40 -translate-y-1/2 rounded-l-xl border border-gray-200 bg-white px-2 py-4 shadow-md transition hover:bg-gray-50"
            title="Open right pane (2)"
          >
            <PanelRightOpen size={18} className="text-gray-600" />
          </button>
        )}

        {!splitMode && selectedPrimitive && rightPaneOpen && (
          <>
            <button
              onClick={toggleRightPane}
              className="fixed inset-0 z-20 bg-slate-950/30 lg:hidden"
              aria-label="Hide right pane"
            />
            <div
              className="fixed inset-x-0 bottom-0 z-30 h-[58vh] rounded-t-2xl bg-white shadow-2xl lg:absolute lg:inset-y-0 lg:right-0 lg:left-auto lg:h-full lg:rounded-none lg:shadow-none"
              style={{ width: rightPaneWidth }}
            >
              <div
                className="absolute inset-y-0 left-0 hidden w-2 cursor-col-resize lg:block"
                onMouseDown={(event) => {
                  event.preventDefault();
                  startResize(event.clientX, rightPaneWidth);
                }}
              >
                <div className="absolute inset-y-0 left-0 w-px bg-gray-200" />
                <div className="absolute left-0 top-1/2 h-16 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-300" />
              </div>
              <PrimitiveDetailPanel
                primitive={selectedPrimitive}
                onOpenCrossMapBacklink={openCrossMapBacklink}
              />
            </div>
          </>
        )}

        {showHelp && <HotkeyHelp onClose={() => setShowHelp(false)} />}
      </div>
    </SyncStatusContext.Provider>
  );
}

function AppBootstrap() {
  const { user, loading } = useAuth();
  const initialized = useMapStore((s) => s.initialized);
  const loadMaps = useMapStore((s) => s.loadMaps);
  const resetState = useMapStore((s) => s.resetState);
  const expectedNamespace = user?.uid ?? 'guest';

  useEffect(() => {
    if (loading) return;
    idb.setStorageNamespace(expectedNamespace);
    resetState();
    void loadMaps();
  }, [expectedNamespace, loading, loadMaps, resetState]);

  if (loading || idb.getStorageNamespace() !== expectedNamespace) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-50">
        <div className="text-sm text-slate-500">Loading…</div>
      </div>
    );
  }

  if (!initialized) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-50">
        <div className="text-sm text-slate-500">Loading…</div>
      </div>
    );
  }

  return (
    <MapPage />
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppBootstrap />
      </AuthProvider>
    </ErrorBoundary>
  );
}
