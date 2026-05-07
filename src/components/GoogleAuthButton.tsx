import { signInWithPopup, signOut, GoogleAuthProvider } from 'firebase/auth';
import { auth, isFirebaseConfigured } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useSyncNow, useSyncStatus } from '../contexts/SyncStatusContext';

const STATUS_DOT: Record<string, string> = {
  idle: '',
  loading: 'bg-yellow-400 animate-pulse',
  saving: 'bg-blue-400 animate-pulse',
  synced: 'bg-green-400',
  error: 'bg-red-400',
};

const STATUS_LABEL: Record<string, string> = {
  loading: 'Loading…',
  saving: 'Saving…',
  synced: 'Synced',
  error: 'Sync error — check console',
};

export default function GoogleAuthButton() {
  const { user, loading } = useAuth();
  const syncStatus = useSyncStatus();
  const syncNow = useSyncNow();

  if (!isFirebaseConfigured) return null;

  const handleSignIn = async () => {
    if (!auth) return;
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch {
      // user cancelled or popup blocked
    }
  };

  const handleSignOut = async () => {
    if (!auth) return;
    try {
      await signOut(auth);
    } catch {
      // ignore
    }
  };

  const dotClass = STATUS_DOT[syncStatus];

  return (
    <div className="border-t border-gray-100">
      {loading ? (
        <div className="px-3 py-2.5 text-xs text-gray-400">Loading…</div>
      ) : user ? (
        <div className="flex flex-col gap-0.5 px-3 py-2.5">
          <div className="flex items-center gap-2">
            {user.photoURL ? (
              <img
                src={user.photoURL}
                referrerPolicy="no-referrer"
                alt=""
                className="h-5 w-5 shrink-0 rounded-full"
              />
            ) : (
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-200 text-[10px] font-medium text-gray-600">
                {user.displayName?.[0] ?? '?'}
              </div>
            )}
            <span className="min-w-0 flex-1 truncate text-xs text-gray-600">
              {user.displayName ?? user.email}
            </span>
            <button
              onClick={() => void syncNow?.()}
              className="shrink-0 text-xs text-sky-600 transition hover:text-sky-800"
              title="Sync now"
            >
              Sync now
            </button>
            <button
              onClick={handleSignOut}
              className="shrink-0 text-xs text-gray-400 transition hover:text-gray-700"
              title="Sign out"
            >
              Sign out
            </button>
          </div>
          {syncStatus !== 'idle' && (
            <div className="flex items-center gap-1.5 pl-7">
              {dotClass && (
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
              )}
              <span
                className={`text-[10px] ${syncStatus === 'error' ? 'text-red-500' : 'text-gray-400'}`}
              >
                {STATUS_LABEL[syncStatus]}
              </span>
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={handleSignIn}
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs text-gray-500 transition hover:bg-gray-50 hover:text-gray-700"
        >
          <GoogleIcon />
          Sign in with Google
        </button>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
