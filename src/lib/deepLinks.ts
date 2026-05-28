export interface DiagramDeepLink {
  mapId: string;
}

export function parseDiagramDeepLink(search: string): DiagramDeepLink | null {
  const params = new URLSearchParams(search);
  const mapId = params.get('map')?.trim();
  if (!mapId) return null;
  return {
    mapId,
  };
}

export function buildDiagramDeepLink({
  mapId,
}: {
  mapId: string;
}) {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('map', mapId);
  return url.toString();
}
