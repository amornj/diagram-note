import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useEditorStore } from '../lib/store';
import { useMapStore } from '../lib/mapStore';
import { getPrimitiveBounds } from '../lib/workspace';
import type { Primitive } from '../types';

interface SearchBoxProps {
  autoFocus?: boolean;
  floating?: boolean;
  onRequestClose?: () => void;
}

const KIND_LABELS: Record<Primitive['kind'], string> = {
  rectangle: 'study box',
  polygon: 'region',
  customline: 'polyline',
  group: 'group',
};

type SearchTypeFilter = 'studybox' | 'group' | 'region' | 'map';
type SearchContentFilter = 'note' | 'tag';

type PrimitiveSearchGroup = {
  key: string;
  name: string;
  representative: Primitive;
  primitives: Primitive[];
};

const TYPE_FILTERS: Array<{
  key: SearchTypeFilter;
  label: string;
  matches: (primitive: Primitive) => boolean;
}> = [
  { key: 'studybox', label: 'Studybox', matches: (primitive) => primitive.kind === 'rectangle' },
  { key: 'group', label: 'Group', matches: (primitive) => primitive.kind === 'group' },
  { key: 'region', label: 'Region', matches: (primitive) => primitive.kind === 'polygon' },
  { key: 'map', label: 'Map', matches: () => false },
];

const CONTENT_FILTERS: Array<{
  key: SearchContentFilter;
  label: string;
}> = [
  { key: 'note', label: 'Note' },
  { key: 'tag', label: 'Tag' },
];

export default function SearchBox({
  autoFocus = false,
  floating = false,
  onRequestClose,
}: SearchBoxProps = {}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [activeTypeFilters, setActiveTypeFilters] = useState<SearchTypeFilter[]>([]);
  const [activeContentFilters, setActiveContentFilters] = useState<SearchContentFilter[]>([]);
  const deferredQuery = useDeferredValue(query);

  const workspace = useEditorStore((s) => s.workspace);
  const selectedPrimitiveId = useEditorStore((s) => s.selectedPrimitiveId);
  const selectedOccurrenceIndex = useEditorStore((s) => s.selectedOccurrenceIndex);
  const setSelectedPrimitiveId = useEditorStore((s) => s.setSelectedPrimitiveId);
  const setSelectedOccurrenceIndex = useEditorStore((s) => s.setSelectedOccurrenceIndex);
  const setZoomTarget = useEditorStore((s) => s.setZoomTarget);
  const maps = useMapStore((s) => s.maps);
  const activeMapId = useMapStore((s) => s.activeMapId);
  const setActiveMap = useMapStore((s) => s.setActiveMap);

  const primitivesById = useMemo(
    () => new Map(workspace.primitives.map((p) => [p.id, p])),
    [workspace.primitives]
  );

  const mapResults = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q || !activeTypeFilters.includes('map')) return [];
    return maps
      .filter((map) => map.name.toLowerCase().includes(q))
      .slice(0, 20);
  }, [activeTypeFilters, deferredQuery, maps]);

  const results = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q || activeTypeFilters.includes('map')) return [];
    const matches = workspace.primitives
      .filter((p) => {
        const matchesType =
          activeTypeFilters.length === 0 ||
          TYPE_FILTERS.some(
            (filter) =>
              filter.key !== 'map' &&
              activeTypeFilters.includes(filter.key) &&
              filter.matches(p)
          );

        if (!matchesType) return false;

        const baseFields = [p.name, ...(p.aliases ?? [])];
        const noteFields = p.notes?.map((n) => `${n.name} ${n.content}`) ?? [];
        const tagFields = p.tags ?? [];
        const searchableFields =
          activeContentFilters.length === 0
            ? [...baseFields, ...tagFields, ...noteFields]
            : [
                ...baseFields,
                ...(activeContentFilters.includes('tag') ? tagFields : []),
                ...(activeContentFilters.includes('note') ? noteFields : []),
              ];
        return searchableFields.join(' ').toLowerCase().includes(q);
      })
      .slice(0, 100);

    const grouped = new Map<string, PrimitiveSearchGroup>();
    for (const primitive of matches) {
      const normalizedName = primitive.name.trim().toLowerCase();
      const key = normalizedName || primitive.id;
      const existing = grouped.get(key);
      if (existing) {
        existing.primitives.push(primitive);
      } else {
        grouped.set(key, {
          key,
          name: primitive.name.trim() || 'Untitled primitive',
          representative: primitive,
          primitives: [primitive],
        });
      }
    }

    return Array.from(grouped.values()).slice(0, 20);
  }, [deferredQuery, workspace.primitives, activeTypeFilters, activeContentFilters]);

  const handleSelect = (group: PrimitiveSearchGroup) => {
    const currentIndex = group.primitives.findIndex(
      (primitive) => primitive.id === selectedPrimitiveId
    );
    const nextIndex =
      group.primitives.length > 1 && currentIndex !== -1
        ? (selectedOccurrenceIndex + 1) % group.primitives.length
        : 0;
    const primitive = group.primitives[nextIndex] ?? group.representative;
    setSelectedPrimitiveId(primitive.id);
    setSelectedOccurrenceIndex(nextIndex);
    const bbox = getPrimitiveBounds(primitive, primitivesById);
    if (bbox) setZoomTarget({ bbox, immediate: false, padding: 16 });
  };

  const handleMapSelect = async (mapId: string) => {
    await setActiveMap(mapId);
    onRequestClose?.();
  };

  const clearQuery = () => {
    setQuery('');
    setSelectedPrimitiveId(null);
  };

  const toggleTypeFilter = (key: SearchTypeFilter) => {
    setActiveTypeFilters((current) =>
      current.includes(key) ? current.filter((value) => value !== key) : [...current, key]
    );
  };

  const toggleContentFilter = (key: SearchContentFilter) => {
    setActiveContentFilters((current) =>
      current.includes(key) ? current.filter((value) => value !== key) : [...current, key]
    );
  };

  useEffect(() => {
    const focusSearch = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;
      if (event.key === '/' && !editing) {
        event.preventDefault();
        focusSearch();
        return;
      }
      if (event.key === 'Escape' && onRequestClose) {
        event.preventDefault();
        onRequestClose();
      }
    };
    const handleSearchFocus = () => focusSearch();
    const handleSearchClear = () => clearQuery();
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('map-search-focus', handleSearchFocus as EventListener);
    window.addEventListener('map-search-clear', handleSearchClear as EventListener);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener(
        'map-search-focus',
        handleSearchFocus as EventListener
      );
      window.removeEventListener(
        'map-search-clear',
        handleSearchClear as EventListener
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onRequestClose]);

  useEffect(() => {
    if (!autoFocus) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [autoFocus]);

  return (
    <div
      className={
        floating
          ? 'w-80 rounded-2xl border border-gray-200 bg-white p-3 shadow-lg'
          : 'border-b border-gray-200 bg-white px-3 py-3'
      }
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            activeTypeFilters.includes('map')
              ? 'Search map names…'
              : 'Search primitives, tags, notes…'
          }
          className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-9 text-sm text-gray-900 outline-none transition focus:border-sky-300 focus:bg-white"
        />
        {query && (
          <button
            onClick={clearQuery}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition hover:text-gray-600"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {TYPE_FILTERS.map((filter) => {
          const active = activeTypeFilters.includes(filter.key);
          return (
            <button
              key={filter.key}
              onClick={() => toggleTypeFilter(filter.key)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                active
                  ? 'bg-slate-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {filter.label}
            </button>
          );
        })}
        {CONTENT_FILTERS.map((filter) => {
          const active = activeContentFilters.includes(filter.key);
          return (
            <button
              key={filter.key}
              onClick={() => toggleContentFilter(filter.key)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                active
                  ? 'bg-sky-600 text-white'
                  : 'bg-sky-50 text-sky-700 hover:bg-sky-100'
              }`}
            >
              {filter.label}
            </button>
          );
        })}
      </div>

      {mapResults.length > 0 && (
        <div className="mt-2 max-h-80 overflow-y-auto rounded-2xl border border-gray-200 bg-white">
          {mapResults.map((map) => (
            <button
              key={map.id}
              onClick={() => void handleMapSelect(map.id)}
              className="block w-full px-3 py-2.5 text-left transition hover:bg-gray-50"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block h-3 w-3 rounded-full ${
                    map.id === activeMapId ? 'bg-sky-500' : 'bg-gray-300'
                  }`}
                />
                <span className="truncate text-sm font-medium text-gray-900">
                  {map.name}
                </span>
                {map.id === activeMapId && (
                  <span className="ml-auto text-[11px] text-sky-600">active</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {results.length > 0 && (
        <div className="mt-2 max-h-80 overflow-y-auto rounded-2xl border border-gray-200 bg-white">
          {results.map((group) => (
            <button
              key={group.key}
              onClick={() => handleSelect(group)}
              className="block w-full px-3 py-2.5 text-left transition hover:bg-gray-50"
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-full"
                  style={{ backgroundColor: group.representative.color }}
                />
                <span className="truncate text-sm font-medium text-gray-900">
                  {group.name}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  {group.primitives.length > 1 && (
                    <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                      {selectedPrimitiveId &&
                      group.primitives.some((primitive) => primitive.id === selectedPrimitiveId)
                        ? `${(selectedOccurrenceIndex % group.primitives.length) + 1}/${group.primitives.length}`
                        : `${group.primitives.length}`}
                    </span>
                  )}
                  <span className="text-[11px] text-gray-400">
                    {KIND_LABELS[group.representative.kind]}
                  </span>
                </div>
              </div>
              {group.representative.tags && group.representative.tags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {group.representative.tags.slice(0, 4).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
