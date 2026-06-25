import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  auth,
  authPersistenceReady,
  isFirebaseConfigured,
} from '../lib/firebase';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue>({ user: null, loading: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(isFirebaseConfigured);

  useEffect(() => {
    const firebaseAuth = auth;
    if (!firebaseAuth) return;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    const timeout = window.setTimeout(() => setLoading(false), 4000);

    void authPersistenceReady.then(() => {
      if (cancelled) return;
      unsubscribe = onAuthStateChanged(
        firebaseAuth,
        (next) => {
          window.clearTimeout(timeout);
          setUser(next);
          setLoading(false);
        },
        () => {
          window.clearTimeout(timeout);
          setLoading(false);
        }
      );
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      unsubscribe?.();
    };
  }, []);

  return <AuthContext.Provider value={{ user, loading }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
