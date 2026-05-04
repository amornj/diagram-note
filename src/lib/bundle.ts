import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import type { DiagramMap, DnoteManifest } from '../types';

function sanitizeFilename(name: string) {
  const cleaned = (name ?? 'map').trim().replace(/[^a-z0-9-_ ]+/gi, '_');
  return cleaned.length > 0 ? cleaned : 'map';
}

export async function exportDnote(
  map: DiagramMap,
  pdfBlob: Blob
): Promise<{ blob: Blob; filename: string }> {
  const manifest: DnoteManifest = {
    format: 'dnote',
    version: 1,
    map: {
      id: map.id,
      name: map.name,
      pdfHash: map.pdfHash,
      pageIndex: map.pageIndex,
      sourceWidth: map.sourceWidth,
      sourceHeight: map.sourceHeight,
      renderScale: map.renderScale,
      createdAt: map.createdAt,
      updatedAt: map.updatedAt,
    },
  };

  const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());
  const zipped = zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
    'workspace.json': strToU8(JSON.stringify(map.workspace, null, 2)),
    'map.pdf': pdfBytes,
  });

  // Copy into a fresh ArrayBuffer to satisfy Blob's BlobPart typing.
  const zipBuf = new ArrayBuffer(zipped.length);
  new Uint8Array(zipBuf).set(zipped);

  return {
    blob: new Blob([zipBuf], { type: 'application/zip' }),
    filename: `${sanitizeFilename(map.name)}.dnote`,
  };
}

export async function importDnote(
  file: File | Blob
): Promise<{ map: DiagramMap; pdfBlob: Blob }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(bytes);
  const manifestBytes = entries['manifest.json'];
  const workspaceBytes = entries['workspace.json'];
  const pdfBytes = entries['map.pdf'];
  if (!manifestBytes || !workspaceBytes || !pdfBytes) {
    throw new Error('Not a valid .dnote file');
  }
  const manifest = JSON.parse(strFromU8(manifestBytes)) as DnoteManifest;
  if (manifest.format !== 'dnote' || manifest.version !== 1) {
    throw new Error(
      `Unsupported .dnote (format=${manifest.format}, version=${manifest.version})`
    );
  }
  const workspace = JSON.parse(strFromU8(workspaceBytes));
  const map: DiagramMap = {
    ...manifest.map,
    workspace,
  };
  // pdfBytes is a slice into a larger ArrayBuffer; copy to a fresh buffer
  // before wrapping in a Blob to avoid future mutations being observable.
  const fresh = new Uint8Array(pdfBytes.length);
  fresh.set(pdfBytes);
  const pdfBlob = new Blob([fresh], { type: 'application/pdf' });
  return { map, pdfBlob };
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
