import { deleteObject, getBlob, ref, uploadBytes } from 'firebase/storage';
import { storage } from './firebase';

export function mapSourcePath(uid: string, mapId: string) {
  return `users/${uid}/maps/${mapId}/source`;
}

export async function uploadMapSource(
  uid: string,
  mapId: string,
  blob: Blob,
  contentType?: string
): Promise<string | null> {
  if (!storage) return null;
  const path = mapSourcePath(uid, mapId);
  await uploadBytes(ref(storage, path), blob, {
    contentType: contentType || blob.type || undefined,
  });
  return path;
}

export async function downloadMapSource(path: string): Promise<Blob | null> {
  if (!storage) return null;
  return getBlob(ref(storage, path));
}

export async function deleteMapSource(path: string): Promise<void> {
  if (!storage) return;
  try {
    await deleteObject(ref(storage, path));
  } catch {
    // Ignore missing remote files so local deletion still succeeds.
  }
}
