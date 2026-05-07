import { useEffect, useMemo, useRef, useState } from 'react';
import { PanelRightOpen, X } from 'lucide-react';
import Editor from './components/Editor';
import LeftPane from './components/LeftPane';
import Landing from './components/Landing';
import PrimitiveDetailPanel from './components/PrimitiveDetailPanel';
import ErrorBoundary from './components/ErrorBoundary';
import HotkeyHelp from './components/HotkeyHelp';
import DropOverlay from './components/DropOverlay';
import { useEditorStore } from './lib/store';
import { loadMapPageView, useMapStore } from './lib/mapStore';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SyncStatusContext, type SyncStatus } from './contexts/SyncStatusContext';
import {
  deleteCloudMap,
  loadCloudMaps,
  saveCloudMap,
  saveCloudMaps,
  subscribeCloudMaps,
} from './lib/cloudSync';
import { uploadMapSource } from './lib/cloudStorage';
import * as idb from './lib/idb';
import type { DiagramMap, MapWorkspace } from './types';

/** Keep only one map per pdfHash — prefer isDefault, then most-recently updated. */
function dedupByHash(maps: DiagramMap[]): DiagramMap[] {
  const seen = new Map<string, DiagramMap>();
  const dupeIds = new Set<string>();
  for (const m of maps) {
    if (!m.pdfHash) continue;
    const prev = seen.get(m.pdfHash);
    if (!prev) { seen.set(m.pdfHash, m); continue; }
    const keep = prev.isDefault ? prev : m.isDefault ? m : (m.updatedAt >= prev.updatedAt ? m : prev);
    dupeIds.add(keep === prev ? m.id : prev.id);
    seen.set(m.pdfHash, keep);
  }
  return dupeIds.size ? maps.filter((m) => !dupeIds.has(m.id)) : maps;
}

function snapshotMaps(maps: DiagramMap[]) {
  return new Map(maps.map((map) => [map.id, JSON.stringify(mapForCloud(map))]));
}

function mapForCloud(map: DiagramMap): DiagramMap {
  const { lastOpenedAt: _lastOpenedAt, ...rest } = map;
  return rest;
}

async function backfillCloudSourcePaths(
  uid: string,
  maps: DiagramMap[]
): Promise<DiagramMap[]> {
  let changed = false;
  const nextMaps = [...maps];
  for (let index = 0; index < nextMaps.length; index += 1) {
    const map = nextMaps[index];
    if (map.isDefault || map.sourceStoragePath) continue;
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

async function mergeCloudMaps(cloud: DiagramMap[]) {
  const localMaps = useMapStore.getState().maps;
  const cloudIds = new Set(cloud.map((map) => map.id));
  const toDelete = localMaps.filter((map) => !map.isDefault && !cloudIds.has(map.id));
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
    return !local || cm.updatedAt > local.updatedAt;
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
    const fallbackId = useMapStore.getState().maps[0]?.id ?? null;
    await useMapStore.getState().setActiveMap(fallbackId);
  } else if (activeId && mergeById.has(activeId)) {
    const activeMap = mergeById.get(activeId)!;
    useEditorStore.getState().setWorkspace(activeMap.workspace);
    await useMapStore.getState().setActiveMap(activeId);
  }
}

function useCloudSync(): SyncStatus {
  const maps = useMapStore((s) => s.maps);
  const { user } = useAuth();
  const syncReadyRef = useRef(false);
  const prevUidRef = useRef<string | null>(null);
  const persistedRef = useRef<Map<string, string>>(new Map());
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [syncReady, setSyncReady] = useState(false);

  // On login: load cloud maps and merge (newer updatedAt wins)
  useEffect(() => {
    if (!user) {
      prevUidRef.current = null;
      syncReadyRef.current = false;
      persistedRef.current = new Map();
      setSyncReady(false);
      setStatus('idle');
      return;
    }
    if (prevUidRef.current === user.uid) return;
    prevUidRef.current = user.uid;
    syncReadyRef.current = false;
    setStatus('loading');

    loadCloudMaps(user.uid).then(async (cloud) => {
      if (cloud === 'error') {
        syncReadyRef.current = true;
        setSyncReady(true);
        setStatus('error');
        return;
      }
      if (cloud && cloud.length > 0) {
        persistedRef.current = snapshotMaps(cloud);
        await mergeCloudMaps(cloud);
      } else if (!cloud) {
        // First login — push local maps to cloud
        const localMaps = await backfillCloudSourcePaths(
          user.uid,
          useMapStore.getState().maps
        );
        if (localMaps.length > 0) {
          const deduped = dedupByHash(localMaps);
          const ok = await saveCloudMaps(
            user.uid,
            deduped.map((map) => mapForCloud(map))
          );
          if (ok) persistedRef.current = snapshotMaps(deduped);
        }
      }
      syncReadyRef.current = true;
      setSyncReady(true);
      setStatus('synced');
    });
  }, [user?.uid]);

  useEffect(() => {
    if (!user || !syncReady) return;
    const unsubscribe = subscribeCloudMaps(user.uid, {
      onData: (cloud) => {
        setStatus('loading');
        const nextCloud = cloud ?? [];
        persistedRef.current = snapshotMaps(nextCloud);
        void mergeCloudMaps(nextCloud).then(() => setStatus('synced'));
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

  return status;
}

function workspaceForPage(map: DiagramMap, pageIndex: number): MapWorkspace {
  return map.pages?.[pageIndex]?.workspace ?? map.workspace;
}

function ComparePane({
  mapId,
  pageIndex,
  title,
  onPageChange,
}: {
  mapId: string | null;
  pageIndex: number;
  title: string;
  onPageChange: (pageIndex: number) => void;
}) {
  const [state, setState] = useState<{
    rasterUrl: string | null;
    dims: { width: number; height: number } | null;
    pageCount: number;
    pageIndex: number;
    workspace: MapWorkspace | null;
    mapName: string;
  }>({
    rasterUrl: null,
    dims: null,
    pageCount: 1,
    pageIndex: 0,
    workspace: null,
    mapName: title,
  });

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    if (!mapId) {
      setState({
        rasterUrl: null,
        dims: null,
        pageCount: 1,
        pageIndex: 0,
        workspace: null,
        mapName: title,
      });
      return;
    }
    void (async () => {
      const view = await loadMapPageView(mapId, pageIndex);
      if (!view || cancelled) return;
      objectUrl = URL.createObjectURL(view.rasterBlob);
      setState({
        rasterUrl: objectUrl,
        dims: view.dims,
        pageCount: view.pageCount,
        pageIndex: view.pageIndex,
        workspace: workspaceForPage(view.map, view.pageIndex),
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
      {state.rasterUrl && state.dims && state.workspace ? (
        <Editor
          rasterUrl={state.rasterUrl}
          dims={state.dims}
          pageIndex={state.pageIndex}
          pageCount={state.pageCount}
          compareOnly
          title={`${title} · ${state.mapName}`}
          workspaceOverride={state.workspace}
          onComparePageChange={onPageChange}
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
  const activeMap = useMapStore((s) => s.maps.find((m) => m.id === s.activeMapId) ?? null);
  const activeRasterUrl = useMapStore((s) => s.activeRasterUrl);
  const [showHelp, setShowHelp] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const [splitMode, setSplitMode] = useState(false);
  const [splitTarget, setSplitTarget] = useState<1 | 2>(1);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [splitMaps, setSplitMaps] = useState<{
    1: { mapId: string | null; pageIndex: number };
    2: { mapId: string | null; pageIndex: number };
  }>({
    1: { mapId: activeMap?.id ?? null, pageIndex: activeMap?.pageIndex ?? 0 },
    2: { mapId: activeMap?.id ?? null, pageIndex: activeMap?.pageIndex ?? 0 },
  });

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
      if ((event.key === 'b' || event.key === 'B') && !editing) {
        event.preventDefault();
        toggleSplitModeRef.current();
        return;
      }
      if (event.key === 'Escape' && !editing && (!leftSidebarCollapsed || rightPaneOpen)) {
        event.preventDefault();
        if (!leftSidebarCollapsed) setLeftSidebarCollapsed(true);
        if (rightPaneOpen && !splitMode) toggleRightPane();
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
  }, [activeMap?.id, activeMap?.pageIndex, splitMode]);

  useEffect(() => {
    if (!dropError) return;
    const t = window.setTimeout(() => setDropError(null), 5000);
    return () => window.clearTimeout(t);
  }, [dropError]);

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
        setSplitMaps({
          1: { mapId: activeMap.id, pageIndex: activeMap.pageIndex },
          2: { mapId: activeMap.id, pageIndex: activeMap.pageIndex },
        });
      }
      return next;
    });
  };
  const toggleSplitModeRef = useRef(toggleSplitMode);
  toggleSplitModeRef.current = toggleSplitMode;

  const assignSplitMap = (mapId: string) => {
    const map = useMapStore.getState().maps.find((entry) => entry.id === mapId);
    setSplitMaps((current) => ({
      ...current,
      [splitTarget]: {
        mapId,
        pageIndex: map?.pageIndex ?? 0,
      },
    }));
  };

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

  if (!activeMap || !activeRasterUrl) {
    return (
      <SyncStatusContext.Provider value={syncStatus}>
        <Landing />
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
                  onPageChange={(page) =>
                    setSplitMaps((current) => ({
                      ...current,
                      1: { ...current[1], pageIndex: page },
                    }))
                  }
                />
                <button
                  onClick={() => setSplitMode(false)}
                  className="absolute right-4 top-4 z-30 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white/90 shadow transition hover:bg-black/80"
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
                  onPageChange={(page) =>
                    setSplitMaps((current) => ({
                      ...current,
                      2: { ...current[2], pageIndex: page },
                    }))
                  }
                />
                <button
                  onClick={() => setSplitMode(false)}
                  className="absolute right-4 top-4 z-30 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white/90 shadow transition hover:bg-black/80"
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
              onToggleSplitMode={() => {
                toggleSplitMode();
              }}
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
              splitTarget={splitTarget}
              splitAssignments={{
                1: splitMaps[1].mapId,
                2: splitMaps[2].mapId,
              }}
              onSetSplitTarget={setSplitTarget}
              onAssignMapToSplit={assignSplitMap}
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
              <PrimitiveDetailPanel primitive={selectedPrimitive} />
            </div>
          </>
        )}

        <DropOverlay onError={setDropError} />
        {showHelp && <HotkeyHelp onClose={() => setShowHelp(false)} />}
        {dropError && (
          <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-xs font-medium text-red-700 shadow-lg">
            {dropError}
          </div>
        )}
      </div>
    </SyncStatusContext.Provider>
  );
}

export default function App() {
  const initialized = useMapStore((s) => s.initialized);
  const loadMaps = useMapStore((s) => s.loadMaps);

  useEffect(() => {
    loadMaps();
  }, [loadMaps]);

  if (!initialized) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-50">
        <div className="text-sm text-slate-500">Loading…</div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <AuthProvider>
        <MapPage />
      </AuthProvider>
    </ErrorBoundary>
  );
}
