import type { DiagramMap } from '../types';

const DB_NAME = 'diagram-note';
const DB_VERSION = 1;

const STORE_MAPS = 'maps';
const STORE_PDFS = 'pdfs';
const STORE_RASTERS = 'rasters';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_MAPS)) {
        db.createObjectStore(STORE_MAPS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_PDFS)) {
        db.createObjectStore(STORE_PDFS, { keyPath: 'mapId' });
      }
      if (!db.objectStoreNames.contains(STORE_RASTERS)) {
        db.createObjectStore(STORE_RASTERS, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db: IDBDatabase, stores: string[], mode: IDBTransactionMode) {
  return db.transaction(stores, mode);
}

function asPromise<T = unknown>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listMaps(): Promise<DiagramMap[]> {
  const db = await openDb();
  const store = tx(db, [STORE_MAPS], 'readonly').objectStore(STORE_MAPS);
  const result = (await asPromise(store.getAll())) as DiagramMap[];
  return result.sort((a, b) => {
    const orderA = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return b.updatedAt - a.updatedAt;
  });
}

export async function getMap(id: string): Promise<DiagramMap | null> {
  const db = await openDb();
  const store = tx(db, [STORE_MAPS], 'readonly').objectStore(STORE_MAPS);
  const result = (await asPromise(store.get(id))) as DiagramMap | undefined;
  return result ?? null;
}

export async function putMap(map: DiagramMap): Promise<void> {
  const db = await openDb();
  const store = tx(db, [STORE_MAPS], 'readwrite').objectStore(STORE_MAPS);
  await asPromise(store.put(map));
}

export async function deleteMap(id: string): Promise<void> {
  const db = await openDb();
  const transaction = tx(db, [STORE_MAPS, STORE_PDFS, STORE_RASTERS], 'readwrite');
  await asPromise(transaction.objectStore(STORE_MAPS).delete(id));
  await asPromise(transaction.objectStore(STORE_PDFS).delete(id));
  const rasterStore = transaction.objectStore(STORE_RASTERS);
  const keys = (await asPromise(rasterStore.getAllKeys())) as string[];
  for (const key of keys) {
    if (key.startsWith(`${id}:`)) {
      await asPromise(rasterStore.delete(key));
    }
  }
}

export async function getPdfBlob(mapId: string): Promise<Blob | null> {
  const db = await openDb();
  const store = tx(db, [STORE_PDFS], 'readonly').objectStore(STORE_PDFS);
  const result = (await asPromise(store.get(mapId))) as
    | { mapId: string; blob: Blob }
    | undefined;
  return result?.blob ?? null;
}

export async function putPdfBlob(mapId: string, blob: Blob): Promise<void> {
  const db = await openDb();
  const store = tx(db, [STORE_PDFS], 'readwrite').objectStore(STORE_PDFS);
  await asPromise(store.put({ mapId, blob }));
}

export interface RasterRecord {
  key: string;
  mapId: string;
  scale: number;
  pageIndex: number;
  blob: Blob;
  width: number;
  height: number;
}

function rasterKey(mapId: string, scale: number, pageIndex: number) {
  return `${mapId}:${scale}:${pageIndex}`;
}

export async function getRaster(
  mapId: string,
  scale: number,
  pageIndex: number
): Promise<RasterRecord | null> {
  const db = await openDb();
  const store = tx(db, [STORE_RASTERS], 'readonly').objectStore(STORE_RASTERS);
  const result = (await asPromise(store.get(rasterKey(mapId, scale, pageIndex)))) as
    | RasterRecord
    | undefined;
  // back-compat: a v1 raster keyed without pageIndex (pageIndex 0)
  if (!result && pageIndex === 0) {
    const legacy = (await asPromise(store.get(`${mapId}:${scale}`))) as
      | (Omit<RasterRecord, 'pageIndex'> & { pageIndex?: number })
      | undefined;
    if (legacy) return { ...legacy, pageIndex: 0, key: rasterKey(mapId, scale, 0) };
  }
  return result ?? null;
}

export async function putRaster(
  mapId: string,
  scale: number,
  pageIndex: number,
  blob: Blob,
  width: number,
  height: number
): Promise<void> {
  const db = await openDb();
  const store = tx(db, [STORE_RASTERS], 'readwrite').objectStore(STORE_RASTERS);
  const record: RasterRecord = {
    key: rasterKey(mapId, scale, pageIndex),
    mapId,
    scale,
    pageIndex,
    blob,
    width,
    height,
  };
  await asPromise(store.put(record));
}
