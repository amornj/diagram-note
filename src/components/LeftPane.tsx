import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
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

function sortMaps(maps: DiagramMap[], mode: MapSortMode) {
  const next = [...maps];
  next.sort((a, b) => {
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

interface LeftPaneProps {
  splitMode?: boolean;
  splitTarget?: 1 | 2;
  splitAssignments?: { 1: string | null; 2: string | null };
  onSetSplitTarget?: (target: 1 | 2) => void;
  onAssignMapToSplit?: (mapId: string) => void;
  workspaceOverride?: MapWorkspace | null;
  selectedPrimitiveIdOverride?: string | null;
  onSelectPrimitiveOverride?: (primitiveId: string) => void;
  paneLabel?: string | null;
}

export default function LeftPane({
  splitMode = false,
  splitTarget = 1,
  splitAssignments = { 1: null, 2: null },
  onSetSplitTarget,
  onAssignMapToSplit,
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

  const sortedMaps = useMemo(() => sortMaps(maps, mapSortMode), [maps, mapSortMode]);

  const setAndPersistSortMode = (mode: MapSortMode) => {
    setMapSortMode(mode);
    persistMapSortMode(mode);
  };

  const toggleAlphaSort = () => {
    setAndPersistSortMode(mapSortMode === 'alphaAsc' ? 'alphaDesc' : 'alphaAsc');
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

      <div className="border-b border-gray-100 px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Maps
          </div>
          <div className="flex items-center gap-1">
            {splitMode && (
              <>
              <button
                onClick={() => onSetSplitTarget?.(1)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
                  splitTarget === 1
                    ? 'bg-sky-600 text-white'
                    : 'bg-sky-50 text-sky-700 hover:bg-sky-100'
                }`}
                title="Assign next map to window 1"
              >
                W1
              </button>
              <button
                onClick={() => onSetSplitTarget?.(2)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
                  splitTarget === 2
                    ? 'bg-emerald-600 text-white'
                    : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                }`}
                title="Assign next map to window 2"
              >
                W2
              </button>
              </>
            )}
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
          </div>
        </div>
        <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
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
                        onAssignMapToSplit?.(map.id);
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
                      <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                        W1
                      </span>
                    )}
                    {splitAssignments[2] === map.id && (
                      <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                        W2
                      </span>
                    )}
                  </div>
                )}
                {!map.isDefault && (
                  confirmDeleteId === map.id ? (
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
                  )
                )}
              </div>
            );
          })}
        </div>
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
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Primitives
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
                <span className="text-[10px] text-gray-400">
                  {KIND_LABELS[p.kind]}
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
