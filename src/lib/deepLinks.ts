export interface DiagramDeepLink {
  mapId: string;
  pageIndex: number | null;
  primitiveId: string | null;
}

export function parseDiagramDeepLink(search: string): DiagramDeepLink | null {
  const params = new URLSearchParams(search);
  const mapId = params.get('map')?.trim();
  if (!mapId) return null;
  const rawPage = params.get('page');
  const pageIndex = rawPage === null ? null : Number.parseInt(rawPage, 10);
  return {
    mapId,
    pageIndex: Number.isFinite(pageIndex) ? pageIndex : null,
    primitiveId: params.get('primitive')?.trim() || null,
  };
}

export function buildDiagramDeepLink({
  mapId,
  pageIndex,
  primitiveId,
}: {
  mapId: string;
  pageIndex: number;
  primitiveId?: string | null;
}) {
  const url = new URL(window.location.href);
  url.searchParams.set('map', mapId);
  url.searchParams.set('page', String(Math.max(0, pageIndex)));
  if (primitiveId) {
    url.searchParams.set('primitive', primitiveId);
  } else {
    url.searchParams.delete('primitive');
  }
  return url.toString();
}
