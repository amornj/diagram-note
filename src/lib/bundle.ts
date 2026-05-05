import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import type { DiagramMap, DnoteManifest, MapWorkspace, PageMeta } from '../types';
import { EMPTY_WORKSPACE } from './workspace';

function sanitizeFilename(name: string) {
  const cleaned = (name ?? 'map').trim().replace(/[^a-z0-9-_ ]+/gi, '_');
  return cleaned.length > 0 ? cleaned : 'map';
}

/**
 * The shape of workspace.json on disk. Pages are keyed by their pageIndex
 * (as a string, since JSON object keys are strings).
 */
interface WorkspaceFile {
  pages: Record<string, MapWorkspace>;
}

function isMapWorkspace(value: unknown): value is MapWorkspace {
  return (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    'primitives' in value &&
    Array.isArray((value as MapWorkspace).primitives)
  );
}

export async function exportDnote(
  map: DiagramMap,
  sourceBlob: Blob
): Promise<{ blob: Blob; filename: string }> {
  const manifest: DnoteManifest = {
    format: 'dnote',
    version: 1,
    map: {
      id: map.id,
      name: map.name,
      pdfHash: map.pdfHash,
      sourceType: map.sourceType,
      sourceName: map.sourceName,
      sourceMimeType: map.sourceMimeType,
      sortOrder: map.sortOrder,
      pageIndex: map.pageIndex,
      pageCount: map.pageCount,
      sourceWidth: map.sourceWidth,
      sourceHeight: map.sourceHeight,
      renderScale: map.renderScale,
      createdAt: map.createdAt,
      updatedAt: map.updatedAt,
    },
  };

  // Build per-page workspace map, defaulting unseen pages to empty workspaces.
  const pages: Record<string, MapWorkspace> = {};
  pages[String(map.pageIndex)] = map.workspace;
  for (const [key, meta] of Object.entries(map.pages ?? {})) {
    pages[key] = meta.workspace;
  }
  const workspaceFile: WorkspaceFile = { pages };

  const sourceBytes = new Uint8Array(await sourceBlob.arrayBuffer());
  const zipped = zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
    'workspace.json': strToU8(JSON.stringify(workspaceFile, null, 2)),
    'map.file': sourceBytes,
  });

  const zipBuf = new ArrayBuffer(zipped.length);
  new Uint8Array(zipBuf).set(zipped);

  return {
    blob: new Blob([zipBuf], { type: 'application/zip' }),
    filename: `${sanitizeFilename(map.name)}.dnote`,
  };
}

export async function importDnote(
  file: File | Blob
): Promise<{ map: DiagramMap; sourceBlob: Blob }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(bytes);
  const manifestBytes = entries['manifest.json'];
  const workspaceBytes = entries['workspace.json'];
  const sourceBytes = entries['map.file'] ?? entries['map.pdf'];
  if (!manifestBytes || !workspaceBytes || !sourceBytes) {
    throw new Error('Not a valid .dnote file');
  }
  const manifest = JSON.parse(strFromU8(manifestBytes)) as DnoteManifest;
  if (manifest.format !== 'dnote' || manifest.version !== 1) {
    throw new Error(
      `Unsupported .dnote (format=${manifest.format}, version=${manifest.version})`
    );
  }
  const parsed = JSON.parse(strFromU8(workspaceBytes)) as unknown;

  // workspace.json may be either a bare single-page MapWorkspace (legacy)
  // or the multi-page WorkspaceFile shape. Normalise to a `pages` map.
  const pagesRaw: Record<string, MapWorkspace> = isMapWorkspace(parsed)
    ? { [String(manifest.map.pageIndex)]: parsed }
    : ((parsed as WorkspaceFile)?.pages ?? {});

  const pages: Record<number, PageMeta> = {};
  for (const [key, workspace] of Object.entries(pagesRaw)) {
    const idx = Number.parseInt(key, 10);
    if (!Number.isFinite(idx)) continue;
    pages[idx] = {
      workspace,
      sourceWidth: manifest.map.sourceWidth,
      sourceHeight: manifest.map.sourceHeight,
    };
  }

  const activeWorkspace =
    pages[manifest.map.pageIndex]?.workspace ?? EMPTY_WORKSPACE;

  const map: DiagramMap = {
    ...manifest.map,
    workspace: activeWorkspace,
    pages,
  };

  // copy bytes into a fresh buffer so the Blob owns its own memory
  const fresh = new Uint8Array(sourceBytes.length);
  fresh.set(sourceBytes);
  const sourceBlob = new Blob([fresh], {
    type: map.sourceMimeType ?? (map.sourceType === 'image' ? 'image/png' : 'application/pdf'),
  });
  return { map, sourceBlob };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
