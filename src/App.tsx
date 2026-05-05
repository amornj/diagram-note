import { useEffect, useMemo, useRef, useState } from 'react';
import { PanelRightOpen } from 'lucide-react';
import Editor from './components/Editor';
import LeftPane from './components/LeftPane';
import PrimitiveDetailPanel from './components/PrimitiveDetailPanel';
import Landing from './components/Landing';
import ErrorBoundary from './components/ErrorBoundary';
import HotkeyHelp from './components/HotkeyHelp';
import DropOverlay from './components/DropOverlay';
import { useEditorStore } from './lib/store';
import { useMapStore } from './lib/mapStore';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SyncStatusContext, type SyncStatus } from './contexts/SyncStatusContext';
import { loadCloudMaps, saveCloudMaps } from './lib/cloudSync';
import * as idb from './lib/idb';

function useCloudSync(): SyncStatus {
  const maps = useMapStore((s) => s.maps);
  const { user } = useAuth();
  const syncReadyRef = useRef(false);
  const prevUidRef = useRef<string | null>(null);
  const [status, setStatus] = useState<SyncStatus>('idle');

  // On login: load cloud maps and merge (newer updatedAt wins)
  useEffect(() => {
    if (!user) {
      prevUidRef.current = null;
      syncReadyRef.current = false;
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
        setStatus('error');
        return;
      }
      if (cloud && cloud.length > 0) {
        const localMaps = useMapStore.getState().maps;
        const localById = new Map(localMaps.map((m) => [m.id, m]));
        const toMerge = cloud.filter((cm) => {
          const local = localById.get(cm.id);
          return !local || cm.updatedAt > local.updatedAt;
        });
        if (toMerge.length > 0) {
          for (const m of toMerge) await idb.putMap(m);
          const mergeById = new Map(toMerge.map((m) => [m.id, m]));
          useMapStore.setState((s) => {
            const updated = s.maps.map((m) => mergeById.get(m.id) ?? m);
            const added = toMerge.filter((m) => !localById.has(m.id));
            return {
              maps: [...updated, ...added].sort((a, b) => b.updatedAt - a.updatedAt),
            };
          });
          // If the active map was updated, refresh its editor workspace
          const activeId = useMapStore.getState().activeMapId;
          if (activeId && mergeById.has(activeId)) {
            useEditorStore.getState().setWorkspace(mergeById.get(activeId)!.workspace);
          }
        }
      } else if (!cloud) {
        // First login — push local maps to cloud
        const localMaps = useMapStore.getState().maps;
        if (localMaps.length > 0) {
          saveCloudMaps(user.uid, localMaps);
        }
      }
      syncReadyRef.current = true;
      setStatus('synced');
    });
  }, [user?.uid]);

  // On maps change: debounce-save to cloud
  useEffect(() => {
    if (!user || !syncReadyRef.current) return;
    const uid = user.uid;
    setStatus('saving');
    const timer = setTimeout(async () => {
      const ok = await saveCloudMaps(uid, useMapStore.getState().maps);
      setStatus(ok ? 'synced' : 'error');
    }, 3000);
    return () => clearTimeout(timer);
  }, [user, maps]);

  return status;
}

function MapPage() {
  const syncStatus = useCloudSync();

  const selectedPrimitiveId = useEditorStore((s) => s.selectedPrimitiveId);
  const workspace = useEditorStore((s) => s.workspace);
  const toggleRightPane = useEditorStore((s) => s.toggleRightPane);
  const rightPaneOpen = useEditorStore((s) => s.rightPaneOpen);
  const leftSidebarCollapsed = useEditorStore((s) => s.leftSidebarCollapsed);
  const activeMap = useMapStore((s) => s.maps.find((m) => m.id === s.activeMapId) ?? null);
  const activeRasterUrl = useMapStore((s) => s.activeRasterUrl);
  const [showHelp, setShowHelp] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

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
        setShowHelp(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showHelp]);

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

  if (!activeMap || !activeRasterUrl) {
    return (
      <SyncStatusContext.Provider value={syncStatus}>
        <Landing />
        <DropOverlay onError={setDropError} />
        {dropError && (
          <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-xs font-medium text-red-700 shadow-lg">
            {dropError}
          </div>
        )}
      </SyncStatusContext.Provider>
    );
  }

  const dims = { width: activeMap.sourceWidth, height: activeMap.sourceHeight };

  return (
    <SyncStatusContext.Provider value={syncStatus}>
      <div className="relative h-screen w-screen overflow-hidden bg-gray-50">
        <div className="absolute inset-0">
          <Editor
            rasterUrl={activeRasterUrl}
            dims={dims}
            pageIndex={activeMap.pageIndex}
            pageCount={activeMap.pageCount}
          />
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-0 z-30">
          <div
            className="pointer-events-auto relative h-full"
            style={{ width: leftSidebarCollapsed ? undefined : leftPaneWidth }}
          >
            <LeftPane />
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

        {selectedPrimitive && !rightPaneOpen && (
          <button
            onClick={toggleRightPane}
            className="fixed right-0 top-1/2 z-40 -translate-y-1/2 rounded-l-xl border border-gray-200 bg-white px-2 py-4 shadow-md transition hover:bg-gray-50"
            title="Open right pane (2)"
          >
            <PanelRightOpen size={18} className="text-gray-600" />
          </button>
        )}

        {selectedPrimitive && rightPaneOpen && (
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
