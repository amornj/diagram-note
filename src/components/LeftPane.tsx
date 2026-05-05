import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { useEditorStore } from '../lib/store';
import { useMapStore } from '../lib/mapStore';
import type { Primitive } from '../types';
import ImportExportBar from './ImportExportBar';
import GoogleAuthButton from './GoogleAuthButton';

const KIND_LABELS: Record<Primitive['kind'], string> = {
  rectangle: 'Study box',
  polygon: 'Region',
  customline: 'Polyline',
  group: 'Group',
};

export default function LeftPane() {
  const leftSidebarCollapsed = useEditorStore((s) => s.leftSidebarCollapsed);
  const toggleLeftSidebar = useEditorStore((s) => s.toggleLeftSidebar);
  const workspace = useEditorStore((s) => s.workspace);
  const setSelectedPrimitiveId = useEditorStore((s) => s.setSelectedPrimitiveId);
  const setHoveredPrimitiveId = useEditorStore((s) => s.setHoveredPrimitiveId);
  const selectedPrimitiveId = useEditorStore((s) => s.selectedPrimitiveId);

  const maps = useMapStore((s) => s.maps);
  const activeMapId = useMapStore((s) => s.activeMapId);
  const setActiveMap = useMapStore((s) => s.setActiveMap);
  const renameMap = useMapStore((s) => s.renameMap);
  const deleteMap = useMapStore((s) => s.deleteMap);

  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const p of workspace.primitives) {
      for (const tag of p.tags ?? []) tags.add(tag);
    }
    return Array.from(tags).sort();
  }, [workspace.primitives]);

  const filteredPrimitives = useMemo(() => {
    if (!activeTagFilter) return workspace.primitives;
    return workspace.primitives.filter((p) => p.tags?.includes(activeTagFilter));
  }, [workspace.primitives, activeTagFilter]);

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
            {workspace.primitives.length} primitive
            {workspace.primitives.length === 1 ? '' : 's'}
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
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Maps
        </div>
        <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
          {maps.length === 0 && (
            <div className="text-xs text-gray-400">
              No maps yet. Drop a PDF or .dnote.
            </div>
          )}
          {maps.map((map) => {
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
                    onClick={() => setActiveMap(map.id)}
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
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Primitives
        </div>
        <div className="mt-2 space-y-1">
          {filteredPrimitives.length === 0 && (
            <div className="text-xs text-gray-400">
              {workspace.primitives.length === 0
                ? 'Press 6 to draw a study box, 8 for a polyline.'
                : 'No primitives match this tag.'}
            </div>
          )}
          {filteredPrimitives.map((p) => {
            const isSelected = p.id === selectedPrimitiveId;
            return (
              <button
                key={p.id}
                onClick={() => setSelectedPrimitiveId(p.id)}
                onMouseEnter={() => setHoveredPrimitiveId(p.id)}
                onMouseLeave={() => setHoveredPrimitiveId(null)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${
                  isSelected
                    ? 'bg-sky-50 border border-sky-200'
                    : 'hover:bg-gray-50'
                }`}
              >
                <span
                  className="inline-block h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: p.color }}
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

      <GoogleAuthButton />
    </div>
  );
}
