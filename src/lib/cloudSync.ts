import { doc, setDoc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import type { DiagramMap } from '../types';

export async function loadCloudMaps(
  uid: string
): Promise<DiagramMap[] | null | 'error'> {
  if (!db) return null;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'data', 'maps'));
    if (!snap.exists()) return null;
    const data = snap.data() as { maps: DiagramMap[] };
    return data.maps ?? null;
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
    await setDoc(doc(db, 'users', uid, 'data', 'maps'), { maps });
    return true;
  } catch (err) {
    console.error('[cloud] save failed:', err);
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
    doc(db, 'users', uid, 'data', 'maps'),
    (snap) => {
      if (!snap.exists()) {
        callbacks.onData(null);
        return;
      }
      const data = snap.data() as { maps: DiagramMap[] };
      callbacks.onData(data.maps ?? null);
    },
    (error) => callbacks.onError(error)
  );
}
