import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from './firebase';

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type PhotoUploadError =
  | { kind: 'unsupportedType' }
  | { kind: 'tooLarge'; bytes: number }
  | { kind: 'notSignedIn' }
  | { kind: 'storageUnavailable' }
  | { kind: 'failed'; message: string };

export function mapSourcePath(uid: string, mapId: string) {
  return `users/${uid}/maps/${mapId}/source`;
}

export function primitivePhotoPath(uid: string, mapId: string, primitiveId: string) {
  return `users/${uid}/maps/${mapId}/primitives/${primitiveId}/photo`;
}

export function notePhotoPath(
  uid: string,
  mapId: string,
  primitiveId: string,
  noteId: string
) {
  return `users/${uid}/maps/${mapId}/primitives/${primitiveId}/notes/${noteId}/photo`;
}

export function validatePhotoFile(file: File): PhotoUploadError | null {
  if (!PHOTO_MIME_TYPES.includes(file.type as (typeof PHOTO_MIME_TYPES)[number])) {
    return { kind: 'unsupportedType' };
  }
  if (file.size > PHOTO_MAX_BYTES) {
    return { kind: 'tooLarge', bytes: file.size };
  }
  return null;
}

export async function uploadPhoto(
  path: string,
  file: Blob,
  contentType?: string
): Promise<{ path: string; url: string } | null> {
  if (!storage) return null;
  await uploadBytes(ref(storage, path), file, {
    contentType: contentType || file.type || undefined,
  });
  const url = await getDownloadURL(ref(storage, path));
  return { path, url };
}

export async function deletePhoto(path: string): Promise<void> {
  if (!storage) return;
  try {
    await deleteObject(ref(storage, path));
  } catch {
    // Ignore missing remote files so local deletion still succeeds.
  }
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
