import { createContext, useContext } from 'react';

export type SyncStatus = 'idle' | 'loading' | 'saving' | 'synced' | 'error';

interface SyncStatusContextValue {
  status: SyncStatus;
  syncNow: (() => Promise<void>) | null;
}

export const SyncStatusContext = createContext<SyncStatusContextValue>({
  status: 'idle',
  syncNow: null,
});

export function useSyncStatus() {
  return useContext(SyncStatusContext).status;
}

export function useSyncNow() {
  return useContext(SyncStatusContext).syncNow;
}
