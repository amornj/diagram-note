import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  type Auth,
} from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

const apiKey = import.meta.env.VITE_FIREBASE_API_KEY as string | undefined;
const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined;
const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined;

export const isFirebaseConfigured = Boolean(apiKey && authDomain && projectId);

let _auth: Auth | null = null;
let _db: Firestore | null = null;
let _storage: FirebaseStorage | null = null;
let _authPersistenceReady: Promise<void> = Promise.resolve();

if (isFirebaseConfigured) {
  const app: FirebaseApp = initializeApp({
    apiKey,
    authDomain,
    projectId,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
    appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
  });
  _auth = getAuth(app);
  _authPersistenceReady = setPersistence(_auth, browserLocalPersistence).catch(
    (error: unknown) => {
      console.warn('Unable to enable persistent Firebase authentication.', error);
    }
  );
  _db = getFirestore(app);
  _storage = getStorage(app);
}

export const auth = _auth;
export const authPersistenceReady = _authPersistenceReady;
export const db = _db;
export const storage = _storage;
