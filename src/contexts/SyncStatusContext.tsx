import { createContext, useContext } from 'react';

export type SyncStatus = 'idle' | 'loading' | 'saving' | 'synced' | 'error';

export const SyncStatusContext = createContext<SyncStatus>('idle');

export function useSyncStatus() {
  return useContext(SyncStatusContext);
}
