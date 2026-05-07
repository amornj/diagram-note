import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from './firebase';

export function mapSourcePath(uid: string, mapId: string) {
  return `users/${uid}/maps/${mapId}/source`;
}

function debugStorage(message: string, details?: Record<string, unknown>) {
  if (details) console.info(`[storage] ${message}`, details);
  else console.info(`[storage] ${message}`);
}

export async function uploadMapSource(
  uid: string,
  mapId: string,
  blob: Blob,
  contentType?: string
): Promise<string | null> {
  if (!storage) return null;
  const path = mapSourcePath(uid, mapId);
  debugStorage('upload start', {
    uid,
    mapId,
    path,
    contentType: contentType || blob.type || null,
    size: blob.size,
  });
  await uploadBytes(ref(storage, path), blob, {
    contentType: contentType || blob.type || undefined,
  });
  debugStorage('upload complete', { uid, mapId, path });
  return path;
}

export async function downloadMapSource(path: string): Promise<Blob | null> {
  if (!storage) return null;
  debugStorage('download start', { path });
  const url = await getDownloadURL(ref(storage, path));
  debugStorage('download url resolved', { path, url });
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch storage object: ${response.status}`);
  }
  const blob = await response.blob();
  debugStorage('download complete', { path, size: blob.size, type: blob.type });
  return blob;
}

export async function deleteMapSource(path: string): Promise<void> {
  if (!storage) return;
  try {
    await deleteObject(ref(storage, path));
  } catch {
    // Ignore missing remote files so local deletion still succeeds.
  }
}
