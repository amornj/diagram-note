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
