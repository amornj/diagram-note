import type {
  BBox,
  MapWorkspace,
  Point,
  Primitive,
} from '../types';

export const EMPTY_WORKSPACE: MapWorkspace = {
  version: 1,
  primitives: [],
};

export function makePrimitiveId() {
  return `primitive-${Math.random().toString(36).slice(2, 10)}`;
}

export function makeMemberKey(id: string) {
  return `primitive:${id}`;
}

export function parseMemberKey(key: string): { id: string } | null {
  if (!key.startsWith('primitive:')) return null;
  return { id: key.slice('primitive:'.length) };
}

export function makeRelatedPrimitiveKey(
  id: string,
  pageIndex: number,
  mapId?: string | null
) {
  if (mapId) {
    return `primitive-map-page:${mapId}:${pageIndex}:${id}`;
  }
  return `primitive-page:${pageIndex}:${id}`;
}

export function parseRelatedPrimitiveKey(
  key: string
): { id: string; pageIndex: number | null; mapId: string | null } | null {
  if (key.startsWith('primitive-map-page:')) {
    const rest = key.slice('primitive-map-page:'.length);
    const firstSep = rest.indexOf(':');
    const secondSep = rest.indexOf(':', firstSep + 1);
    if (firstSep <= 0 || secondSep <= firstSep + 1) return null;
    const mapId = rest.slice(0, firstSep);
    const pageIndex = Number.parseInt(rest.slice(firstSep + 1, secondSep), 10);
    const id = rest.slice(secondSep + 1);
    if (!mapId || !Number.isFinite(pageIndex) || !id) return null;
    return { id, pageIndex, mapId };
  }
  if (key.startsWith('primitive-page:')) {
    const rest = key.slice('primitive-page:'.length);
    const sep = rest.indexOf(':');
    if (sep <= 0) return null;
    const pageIndex = Number.parseInt(rest.slice(0, sep), 10);
    const id = rest.slice(sep + 1);
    if (!Number.isFinite(pageIndex) || !id) return null;
    return { id, pageIndex, mapId: null };
  }
  const legacy = parseMemberKey(key);
  if (!legacy) return null;
  return { id: legacy.id, pageIndex: null, mapId: null };
}

export function bboxFromPoints(a: Point, b: Point): BBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const maxX = Math.max(a.x, b.x);
  const maxY = Math.max(a.y, b.y);
  return { x, y, w: maxX - x, h: maxY - y };
}

export function boundsFromPoints(points: Point[]): BBox {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function boundsFromBBoxes(boxes: BBox[]): BBox {
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function getPrimitiveBounds(
  primitive: Primitive,
  primitivesById: Map<string, Primitive>
): BBox | null {
  if (primitive.bbox) return primitive.bbox;
  if (primitive.points?.length) return boundsFromPoints(primitive.points);
  if (primitive.kind === 'group') {
    const memberKeys = getGroupMemberKeys(primitive);
    const boxes: BBox[] = [];
    for (const key of memberKeys) {
      const member = parseMemberKey(key);
      if (!member) continue;
      const memberPrim = primitivesById.get(member.id);
      if (!memberPrim) continue;
      const bbox = getPrimitiveBounds(memberPrim, primitivesById);
      if (bbox) boxes.push(bbox);
    }
    if (boxes.length) return boundsFromBBoxes(boxes);
  }
  return null;
}

export function getGroupMemberKeys(primitive: Primitive): string[] {
  return primitive.groupMemberKeys ?? [];
}

export function getRelatedMemberKeys(primitive: Primitive): string[] {
  return primitive.relatedMemberKeys ?? [];
}

export function normalizeTagInput(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function uniqueTags(tags: string[]) {
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));
}
