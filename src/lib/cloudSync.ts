import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import type { DiagramMap } from '../types';

function mapsCollection(uid: string) {
  return collection(db!, 'users', uid, 'maps');
}

function mapDoc(uid: string, mapId: string) {
  return doc(db!, 'users', uid, 'maps', mapId);
}

export async function loadCloudMaps(
  uid: string
): Promise<DiagramMap[] | null | 'error'> {
  if (!db) return null;
  try {
    const snap = await getDocs(mapsCollection(uid));
    if (snap.empty) return null;
    return snap.docs.map((entry) => entry.data() as DiagramMap);
  } catch (err) {
    console.error('[cloud] load failed:', err);
    return 'error';
  }
}

export async function saveCloudMaps(
  uid: string,
  maps: DiagramMap[]
): Promise<boolean> {
  if (!db) return false;
  try {
    const batch = writeBatch(db);
    const current = await getDocs(mapsCollection(uid));
    const nextIds = new Set(maps.map((map) => map.id));
    for (const entry of current.docs) {
      if (!nextIds.has(entry.id)) batch.delete(entry.ref);
    }
    for (const map of maps) {
      batch.set(mapDoc(uid, map.id), map);
    }
    await batch.commit();
    return true;
  } catch (err) {
    console.error('[cloud] save failed:', err);
    return false;
  }
}

export async function saveCloudMap(
  uid: string,
  map: DiagramMap
): Promise<boolean> {
  if (!db) return false;
  try {
    await setDoc(mapDoc(uid, map.id), map);
    return true;
  } catch (err) {
    console.error('[cloud] save map failed:', err);
    return false;
  }
}

export async function deleteCloudMap(
  uid: string,
  mapId: string
): Promise<boolean> {
  if (!db) return false;
  try {
    await deleteDoc(mapDoc(uid, mapId));
    return true;
  } catch (err) {
    console.error('[cloud] delete map failed:', err);
    return false;
  }
}

export function subscribeCloudMaps(
  uid: string,
  callbacks: {
    onData: (maps: DiagramMap[] | null) => void;
    onError: (error: unknown) => void;
  }
) {
  if (!db) return () => {};
  return onSnapshot(
    mapsCollection(uid),
    (snap) => {
      if (snap.empty) {
        callbacks.onData(null);
        return;
      }
      callbacks.onData(snap.docs.map((entry) => entry.data() as DiagramMap));
    },
    (error) => callbacks.onError(error)
  );
}
