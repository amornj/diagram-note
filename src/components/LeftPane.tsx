import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Pin, Trash2 } from 'lucide-react';
import { useEditorStore } from '../lib/store';
import { useMapStore } from '../lib/mapStore';
import type { DiagramMap, MapWorkspace, Primitive } from '../types';
import ImportExportBar from './ImportExportBar';
import GoogleAuthButton from './GoogleAuthButton';
import { EMPTY_WORKSPACE } from '../lib/workspace';

type MapSortMode = 'recent' | 'alphaAsc' | 'alphaDesc' | 'createdDesc' | 'createdAsc';
type PrimitiveSortMode = 'default' | 'alphaAsc' | 'alphaDesc';

const MAP_SORT_STORAGE_KEY = 'diagram-note-map-sort-mode';
const PRIMITIVE_SORT_STORAGE_KEY = 'diagram-note-primitive-sort-mode';
const PINNED_MAPS_STORAGE_KEY = 'diagram-note-pinned-maps';

function loadPinnedMapIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(PINNED_MAPS_STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {}
  return new Set();
}

function persistPinnedMapIds(ids: Set<string>) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PINNED_MAPS_STORAGE_KEY, JSON.stringify([...ids]));
}

function loadMapSortMode(): MapSortMode {
  if (typeof window === 'undefined') return 'recent';
  const raw = window.localStorage.getItem(MAP_SORT_STORAGE_KEY);
  if (
    raw === 'recent' ||
    raw === 'alphaAsc' ||
    raw === 'alphaDesc' ||
    raw === 'createdDesc' ||
    raw === 'createdAsc'
  ) {
    return raw;
  }
  return 'recent';
}

function persistMapSortMode(mode: MapSortMode) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(MAP_SORT_STORAGE_KEY, mode);
}

function loadPrimitiveSortMode(): PrimitiveSortMode {
  if (typeof window === 'undefined') return 'default';
  const raw = window.localStorage.getItem(PRIMITIVE_SORT_STORAGE_KEY);
  if (raw === 'default' || raw === 'alphaAsc' || raw === 'alphaDesc') {
    return raw;
  }
  return 'default';
}

function persistPrimitiveSortMode(mode: PrimitiveSortMode) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PRIMITIVE_SORT_STORAGE_KEY, mode);
}

function sortMaps(maps: DiagramMap[], mode: MapSortMode, activeMapId: string | null, pinnedIds: Set<string>) {
  const next = [...maps];
  next.sort((a, b) => {
    const aPinned = pinnedIds.has(a.id);
    const bPinned = pinnedIds.has(b.id);
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    switch (mode) {
      case 'alphaAsc':
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      case 'alphaDesc':
        return b.name.localeCompare(a.name, undefined, { sensitivity: 'base' });
      case 'createdAsc':
        return a.createdAt - b.createdAt;
      case 'createdDesc':
        return b.createdAt - a.createdAt;
      case 'recent':
      default: {
        if (a.id === activeMapId && b.id !== activeMapId) return -1;
        if (a.id !== activeMapId && b.id === activeMapId) return 1;
        const aRecent = a.lastOpenedAt ?? a.updatedAt ?? a.createdAt;
        const bRecent = b.lastOpenedAt ?? b.updatedAt ?? b.createdAt;
        return bRecent - aRecent;
      }
    }
  });
  return next;
}

const KIND_LABELS: Record<Primitive['kind'], string> = {
  rectangle: 'Study box',
  polygon: 'Region',
  customline: 'Polyline',
  group: 'Group',
};

const KIND_DOT_COLORS: Record<Primitive['kind'], string> = {
  rectangle: '#ef4444',
  polygon: '#f59e0b',
  customline: '#06b6d4',
  group: '#3b82f6',
};

function CreatedSortIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 3v3" />
      <path d="M13 3v3" />
      <path d="M5 6.5h10.5c1.1 0 2 .9 2 2V12" />
      <path d="M5 8.5V18c0 1.1.9 2 2 2h5" />
      <path d="M8 11h3" />
      <path d="M8 14h3" />
      <path d="M8 17h2.5" />
      <path d="M18 11.5v8" />
      <path d="m14.5 16 3.5 3.5 3.5-3.5" />
    </svg>
  );
}

function NoteMetaIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 4.5h7l4 4v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-12a2 2 0 0 1 2-2Z" />
      <path d="M14 4.5v4h4" />
      <path d="M8.5 12h7" />
      <path d="M8.5 15.5h5.5" />
    </svg>
  );
}

function BacklinkMetaIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.5 13.5 8 16a3 3 0 1 1-4.2-4.2l3.3-3.3A3 3 0 0 1 11.3 8" />
      <path d="m13.5 10.5 2.5-2.5a3 3 0 1 1 4.2 4.2l-3.3 3.3A3 3 0 0 1 12.7 16" />
      <path d="m9 15 6-6" />
    </svg>
  );
}

interface LeftPaneProps {
  splitMode?: boolean;
  splitAssignments?: { 1: string | null; 2: string | null };
  splitTarget?: 1 | 2 | null;
  onSetSplitTarget?: (pane: 1 | 2 | null) => void;
  onAssignMapToSplitPane?: (pane: 1 | 2, mapId: string) => void;
  workspaceOverride?: MapWorkspace | null;
  selectedPrimitiveIdOverride?: string | null;
  onSelectPrimitiveOverride?: (primitiveId: string) => void;
  paneLabel?: string | null;
}

export default function LeftPane({
  splitMode = false,
  splitAssignments = { 1: null, 2: null },
  splitTarget = null,
  onSetSplitTarget,
  onAssignMapToSplitPane,
  workspaceOverride,
  selectedPrimitiveIdOverride = null,
  onSelectPrimitiveOverride,
  paneLabel,
}: LeftPaneProps) {
  const leftSidebarCollapsed = useEditorStore((s) => s.leftSidebarCollapsed);
  const toggleLeftSidebar = useEditorStore((s) => s.toggleLeftSidebar);
  const workspace = useEditorStore((s) => s.workspace);
  const setSelectedPrimitiveId = useEditorStore((s) => s.setSelectedPrimitiveId);
  const setHoveredPrimitiveId = useEditorStore((s) => s.setHoveredPrimitiveId);
  const selectedPrimitiveId = useEditorStore((s) => s.selectedPrimitiveId);
  const effectiveWorkspace =
    workspaceOverride === undefined ? workspace : (workspaceOverride ?? EMPTY_WORKSPACE);
  const effectiveSelectedPrimitiveId =
    workspaceOverride !== undefined ? selectedPrimitiveIdOverride : selectedPrimitiveId;

  const maps = useMapStore((s) => s.maps);
  const activeMapId = useMapStore((s) => s.activeMapId);
  const setActiveMap = useMapStore((s) => s.setActiveMap);
  const renameMap = useMapStore((s) => s.renameMap);
  const deleteMap = useMapStore((s) => s.deleteMap);

  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [mapSortMode, setMapSortMode] = useState<MapSortMode>(loadMapSortMode);
  const [primitiveSortMode, setPrimitiveSortMode] =
    useState<PrimitiveSortMode>(loadPrimitiveSortMode);
  const [pinnedMapIds, setPinnedMapIds] = useState<Set<string>>(loadPinnedMapIds);

  const [mapsHeight, setMapsHeight] = useState(() => {
    if (typeof window === 'undefined') return 192;
    const raw = window.localStorage.getItem('diagram-note-maps-height');
    const parsed = raw ? Number(raw) : 192;
    return Number.isFinite(parsed) ? Math.min(520, Math.max(80, parsed)) : 192;
  });

  useEffect(() => {
    window.localStorage.setItem('diagram-note-maps-height', String(mapsHeight));
  }, [mapsHeight]);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const p of effectiveWorkspace.primitives) {
      for (const tag of p.tags ?? []) tags.add(tag);
    }
    return Array.from(tags).sort();
  }, [effectiveWorkspace.primitives]);

  const filteredPrimitives = useMemo(() => {
    const base = !activeTagFilter
      ? effectiveWorkspace.primitives
      : effectiveWorkspace.primitives.filter((p) => p.tags?.includes(activeTagFilter));
    if (primitiveSortMode === 'default') return base;
    const next = [...base];
    next.sort((a, b) =>
      primitiveSortMode === 'alphaDesc'
        ? b.name.localeCompare(a.name, undefined, { sensitivity: 'base' })
        : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );
    return next;
  }, [effectiveWorkspace.primitives, activeTagFilter, primitiveSortMode]);

  const sortedMaps = useMemo(
    () => sortMaps(maps, mapSortMode, activeMapId, pinnedMapIds),
    [maps, mapSortMode, activeMapId, pinnedMapIds]
  );

  const togglePinMap = (id: string) => {
    setPinnedMapIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persistPinnedMapIds(next);
      return next;
    });
  };

  const setAndPersistSortMode = (mode: MapSortMode) => {
    setMapSortMode(mode);
    persistMapSortMode(mode);
  };

  const toggleAlphaSort = () => {
    setAndPersistSortMode(mapSortMode === 'alphaAsc' ? 'alphaDesc' : 'alphaAsc');
  };

  const toggleCreatedSort = () => {
    setAndPersistSortMode(
      mapSortMode === 'createdDesc' ? 'createdAsc' : 'createdDesc'
    );
  };

  const togglePrimitiveAlphaSort = () => {
    const nextMode =
      primitiveSortMode === 'alphaAsc'
        ? 'alphaDesc'
        : primitiveSortMode === 'alphaDesc'
          ? 'default'
          : 'alphaAsc';
    setPrimitiveSortMode(nextMode);
    persistPrimitiveSortMode(nextMode);
  };

  const startMapsResize = (startY: number, startHeight: number) => {
    const handleMove = (event: MouseEvent) => {
      const delta = event.clientY - startY;
      setMapsHeight(Math.min(520, Math.max(80, startHeight + delta)));
    };
    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  if (leftSidebarCollapsed) {
    return (
      <button
        onClick={toggleLeftSidebar}
        className="absolute left-0 top-1/2 z-30 -translate-y-1/2 rounded-r-xl border border-gray-200 bg-white px-2 py-4 shadow-md transition hover:bg-gray-50"
        title="Open left pane (1)"
      >
        <ChevronRight size={18} className="text-gray-600" />
      </button>
    );
  }

  return (
    <div className="pointer-events-auto flex h-full w-full flex-col border-r border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-3">
        <div>
          <div className="text-sm font-bold text-gray-900">diagram-note</div>
          <div className="text-[11px] text-gray-500">
            {maps.length} map{maps.length === 1 ? '' : 's'} ·{' '}
            {effectiveWorkspace.primitives.length} primitive
            {effectiveWorkspace.primitives.length === 1 ? '' : 's'}
            {splitMode && paneLabel ? ` · ${paneLabel}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <ImportExportBar />
          <button
            onClick={toggleLeftSidebar}
            className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100"
            title="Hide left pane (1)"
          >
            <ChevronLeft size={18} />
          </button>
        </div>
      </div>

      <div className="px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Maps
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setAndPersistSortMode('recent')}
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
                mapSortMode === 'recent'
                  ? 'bg-slate-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              title="Sort by most recent use"
            >
              Recent
            </button>
            <button
              onClick={toggleAlphaSort}
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
                mapSortMode === 'alphaAsc' || mapSortMode === 'alphaDesc'
                  ? 'bg-slate-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              title="Sort by name"
            >
              {mapSortMode === 'alphaDesc' ? 'Z-A' : 'A-Z'}
            </button>
            <button
              onClick={toggleCreatedSort}
              className={`flex h-5 w-6 items-center justify-center rounded-full text-[10px] font-semibold transition ${
                mapSortMode === 'createdDesc' || mapSortMode === 'createdAsc'
                  ? 'bg-slate-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              title={
                mapSortMode === 'createdAsc'
                  ? 'Sort by oldest added first'
                  : 'Sort by newest added first'
              }
              aria-label={
                mapSortMode === 'createdAsc'
                  ? 'Sort by oldest added first'
                  : 'Sort by newest added first'
              }
            >
              <CreatedSortIcon />
            </button>
          </div>
        </div>
        <div className="mt-2 space-y-1 overflow-y-auto" style={{ height: mapsHeight }}>
          {maps.length === 0 && (
            <div className="text-xs text-gray-400">
              No maps yet. Load a PDF, PNG, JPEG, WEBP, or .dnote.
            </div>
          )}
          {sortedMaps.map((map) => {
            const isActive = map.id === activeMapId;
            return (
              <div
                key={map.id}
                className={`flex items-center justify-between gap-1 rounded-lg px-2 py-1.5 transition ${
                  isActive ? 'bg-sky-50 border border-sky-200' : 'hover:bg-gray-50'
                }`}
              >
                {renamingId === map.id ? (
                  <input
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onBlur={() => {
                      const trimmed = renameDraft.trim();
                      if (trimmed && trimmed !== map.name) {
                        renameMap(map.id, trimmed);
                      }
                      setRenamingId(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.currentTarget.blur();
                      }
                      if (event.key === 'Escape') {
                        setRenamingId(null);
                      }
                    }}
                    autoFocus
                    className="w-full rounded border border-gray-200 bg-white px-2 py-1 text-sm outline-none focus:border-sky-300"
                  />
                ) : (
                  <button
                    onClick={() => {
                      if (splitMode) {
                        if (splitTarget !== null) {
                          onAssignMapToSplitPane?.(splitTarget, map.id);
                          onSetSplitTarget?.(null);
                        }
                        return;
                      }
                      void setActiveMap(map.id);
                    }}
                    onDoubleClick={() => {
                      setRenamingId(map.id);
                      setRenameDraft(map.name);
                    }}
                    className="flex-1 truncate text-left text-sm font-medium text-gray-800"
                    title={`${map.name} — double-click to rename`}
                  >
                    {map.name}
                  </button>
                )}
                {splitMode && (
                  <div className="flex items-center gap-1">
                    {splitAssignments[1] === map.id && (
                      <button
                        onClick={() =>
                          onSetSplitTarget?.(splitTarget === 1 ? null : 1)
                        }
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold transition ${
                          splitTarget === 1
                            ? 'bg-sky-600 text-white'
                            : 'bg-sky-100 text-sky-700 hover:bg-sky-200'
                        }`}
                        title="Select window 1, then click another map"
                      >
                        W1
                      </button>
                    )}
                    {splitAssignments[2] === map.id && (
                      <button
                        onClick={() =>
                          onSetSplitTarget?.(splitTarget === 2 ? null : 2)
                        }
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold transition ${
                          splitTarget === 2
                            ? 'bg-emerald-600 text-white'
                            : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                        }`}
                        title="Select window 2, then click another map"
                      >
                        W2
                      </button>
                    )}
                  </div>
                )}
                <button
                  onClick={() => togglePinMap(map.id)}
                  className="rounded-full p-1 transition"
                  aria-label={pinnedMapIds.has(map.id) ? `Unpin ${map.name}` : `Pin ${map.name}`}
                  title={pinnedMapIds.has(map.id) ? 'Unpin map' : 'Pin to top'}
                  style={{ color: pinnedMapIds.has(map.id) ? '#f59e0b' : '#d1d5db' }}
                >
                  <Pin size={12} />
                </button>
                {confirmDeleteId === map.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        deleteMap(map.id);
                        setConfirmDeleteId(null);
                      }}
                      className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold text-white"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-600"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(map.id)}
                    className="rounded-full p-1 text-gray-400 transition hover:bg-red-50 hover:text-red-600"
                    aria-label={`Delete ${map.name}`}
                    title="Delete map"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div
        className="relative z-10 h-2 cursor-row-resize"
        onMouseDown={(event) => {
          event.preventDefault();
          startMapsResize(event.clientY, mapsHeight);
        }}
      >
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-gray-200" />
        <div className="absolute left-1/2 top-1/2 h-1 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-300" />
      </div>

      {allTags.length > 0 && (
        <div className="border-b border-gray-100 px-3 py-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Tags
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            <button
              onClick={() => setActiveTagFilter(null)}
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition ${
                activeTagFilter === null
                  ? 'bg-slate-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              All
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setActiveTagFilter(tag)}
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition ${
                  activeTagFilter === tag
                    ? 'bg-slate-900 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
            <span>Primitives</span>
            {splitMode && paneLabel && (
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-normal text-slate-600">
                {paneLabel}
              </span>
            )}
          </div>
          <button
            onClick={togglePrimitiveAlphaSort}
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
              primitiveSortMode === 'alphaAsc' || primitiveSortMode === 'alphaDesc'
                ? 'bg-slate-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            title="Sort primitives by name"
          >
            {primitiveSortMode === 'alphaDesc'
              ? 'Z-A'
              : primitiveSortMode === 'alphaAsc'
                ? 'A-Z'
                : 'A-Z'}
          </button>
        </div>
        <div className="mt-2 space-y-1">
          {filteredPrimitives.length === 0 && (
            <div className="text-xs text-gray-400">
              {effectiveWorkspace.primitives.length === 0
                ? splitMode
                  ? 'No primitives in this map.'
                  : 'Press 6 to draw a study box, 8 for a polyline.'
                : 'No primitives match this tag.'}
            </div>
          )}
          {filteredPrimitives.map((p) => {
            const isSelected = p.id === effectiveSelectedPrimitiveId;
            const hasNote = (p.notes ?? []).some((note) => note.content.trim());
            const hasBacklink = (p.relatedMemberKeys?.length ?? 0) > 0;
            return (
              <button
                key={p.id}
                onClick={() => {
                  if (workspaceOverride !== undefined) {
                    onSelectPrimitiveOverride?.(p.id);
                    return;
                  }
                  setSelectedPrimitiveId(p.id);
                }}
                onMouseEnter={() => {
                  if (workspaceOverride !== undefined) return;
                  setHoveredPrimitiveId(p.id);
                }}
                onMouseLeave={() => {
                  if (workspaceOverride !== undefined) return;
                  setHoveredPrimitiveId(null);
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${
                  isSelected
                    ? 'bg-sky-50 border border-sky-200'
                    : 'hover:bg-gray-50'
                }`}
              >
                <span
                  className="inline-block h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: KIND_DOT_COLORS[p.kind] }}
                />
                <span className="flex-1 truncate text-sm text-gray-800">
                  {p.name}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {(hasNote || hasBacklink) && (
                    <span className="flex items-center gap-1 text-amber-500">
                      {hasNote && <NoteMetaIcon />}
                      {hasBacklink && <BacklinkMetaIcon />}
                    </span>
                  )}
                  <span className="text-[10px] leading-none text-gray-400">
                    {KIND_LABELS[p.kind]}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-auto">
        <GoogleAuthButton />
      </div>
    </div>
  );
}
