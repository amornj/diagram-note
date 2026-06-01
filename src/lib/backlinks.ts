import type { DiagramMap, MapWorkspace, Primitive } from '../types';
import { parseRelatedTargetKey, type RelatedTarget } from './workspace';

export type ResolvedBacklink = {
  key: string;
  target: RelatedTarget;
  kind: 'map' | 'primitive';
  mapId: string;
  mapName: string;
  pageIndex?: number;
  primitiveId?: string;
  label: string;
  detail: string;
};

export type SoftLinkSource =
  | { kind: 'map'; map: DiagramMap }
  | {
      kind: 'primitive';
      map: DiagramMap;
      pageIndex: number;
      workspace: MapWorkspace;
      primitive: Primitive;
    };

export function workspaceForMapPage(map: DiagramMap, pageIndex: number): MapWorkspace {
  return map.pages?.[pageIndex]?.workspace ?? map.workspace;
}

export function resolveBacklinks({
  keys,
  maps,
  fallbackMap,
  fallbackPageIndex,
  fallbackWorkspace,
}: {
  keys: string[];
  maps: DiagramMap[];
  fallbackMap?: DiagramMap | null;
  fallbackPageIndex?: number;
  fallbackWorkspace?: MapWorkspace | null;
}): ResolvedBacklink[] {
  return keys
    .map((key): ResolvedBacklink | null => {
      const target = parseRelatedTargetKey(key);
      if (!target) return null;
      if (target.kind === 'map') {
        const targetMap = maps.find((map) => map.id === target.mapId);
        if (!targetMap) return null;
        return {
          key,
          target,
          kind: 'map' as const,
          mapId: targetMap.id,
          mapName: targetMap.name,
          label: targetMap.name,
          detail: 'Map',
        };
      }
      const targetMapId = target.mapId ?? fallbackMap?.id ?? null;
      if (!targetMapId) return null;
      const targetMap = maps.find((map) => map.id === targetMapId);
      if (!targetMap) return null;
      const pageIndex = target.pageIndex ?? fallbackPageIndex ?? targetMap.pageIndex ?? 0;
      const pageWorkspace =
        targetMap.id === fallbackMap?.id && pageIndex === fallbackPageIndex && fallbackWorkspace
          ? fallbackWorkspace
          : workspaceForMapPage(targetMap, pageIndex);
      const primitive = pageWorkspace.primitives.find((entry) => entry.id === target.id);
      if (!primitive) return null;
      const sameFallbackMap = targetMap.id === fallbackMap?.id;
      return {
        key,
        target: {
          kind: 'primitive' as const,
          mapId: targetMap.id,
          pageIndex,
          id: primitive.id,
        },
        kind: 'primitive' as const,
        mapId: targetMap.id,
        mapName: targetMap.name,
        pageIndex,
        primitiveId: primitive.id,
        label: primitive.name,
        detail:
          sameFallbackMap && pageIndex === fallbackPageIndex
            ? primitiveKindLabel(primitive)
            : `${targetMap.name}${targetMap.pageCount > 1 ? ` · Page ${pageIndex + 1}` : ''}`,
      };
    })
    .filter((entry): entry is ResolvedBacklink => entry !== null)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'map' ? -1 : 1;
      return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
    });
}

export function resolveSoftLinks({
  source,
  maps,
}: {
  source: SoftLinkSource;
  maps: DiagramMap[];
}): ResolvedBacklink[] {
  const sourceName = normalizeName(source.kind === 'map' ? source.map.name : source.primitive.name);
  if (!sourceName) return [];
  const sourceKey =
    source.kind === 'map'
      ? `map:${source.map.id}`
      : `primitive:${source.map.id}:${source.pageIndex}:${source.primitive.id}`;
  const existingKeys = new Set(
    (source.kind === 'map'
      ? source.map.relatedMemberKeys ?? []
      : source.primitive.relatedMemberKeys ?? []
    ).map((key) =>
      normalizeRelatedKey(key, source.map, source.kind === 'primitive' ? source.pageIndex : undefined)
    )
  );

  const matches: ResolvedBacklink[] = [];
  for (const map of maps) {
    if (map.archivedAt !== undefined) continue;
    const mapTarget: RelatedTarget = { kind: 'map', mapId: map.id };
    const mapKey = `map:${map.id}`;
    if (
      mapKey !== sourceKey &&
      normalizeName(map.name) === sourceName &&
      !existingKeys.has(mapKey)
    ) {
      matches.push({
        key: `soft:${mapKey}`,
        target: mapTarget,
        kind: 'map',
        mapId: map.id,
        mapName: map.name,
        label: map.name,
        detail: 'Map',
      });
    }

    for (const pageIndex of getPageIndexes(map)) {
      const pageWorkspace = workspaceForMapPage(map, pageIndex);
      for (const primitive of pageWorkspace.primitives) {
        const primitiveKey = `primitive:${map.id}:${pageIndex}:${primitive.id}`;
        if (
          primitiveKey === sourceKey ||
          normalizeName(primitive.name) !== sourceName ||
          existingKeys.has(primitiveKey)
        ) {
          continue;
        }
        matches.push({
          key: `soft:${primitiveKey}`,
          target: {
            kind: 'primitive',
            mapId: map.id,
            pageIndex,
            id: primitive.id,
          },
          kind: 'primitive',
          mapId: map.id,
          mapName: map.name,
          pageIndex,
          primitiveId: primitive.id,
          label: primitive.name,
          detail:
            source.kind === 'primitive' && map.id === source.map.id && pageIndex === source.pageIndex
              ? primitiveKindLabel(primitive)
              : `${map.name}${map.pageCount > 1 ? ` · Page ${pageIndex + 1}` : ''}`,
        });
      }
    }
  }
  return matches.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'map' ? -1 : 1;
    if (a.label !== b.label) return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
    return a.detail.localeCompare(b.detail, undefined, { sensitivity: 'base' });
  });
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function getPageIndexes(map: DiagramMap) {
  const indexes = new Set<number>([map.pageIndex]);
  for (const key of Object.keys(map.pages ?? {})) {
    const index = Number(key);
    if (Number.isFinite(index)) indexes.add(index);
  }
  return Array.from(indexes).sort((a, b) => a - b);
}

function normalizeRelatedKey(key: string, fallbackMap: DiagramMap, fallbackPageIndex?: number) {
  const target = parseRelatedTargetKey(key);
  if (!target) return key;
  if (target.kind === 'map') return `map:${target.mapId}`;
  const mapId = target.mapId ?? fallbackMap.id;
  const pageIndex = target.pageIndex ?? fallbackPageIndex ?? fallbackMap.pageIndex;
  return `primitive:${mapId}:${pageIndex}:${target.id}`;
}

function primitiveKindLabel(primitive: Primitive) {
  switch (primitive.kind) {
    case 'rectangle':
      return 'Study box';
    case 'polygon':
      return 'Region';
    case 'customline':
      return 'Polyline';
    case 'group':
      return 'Group';
  }
}
