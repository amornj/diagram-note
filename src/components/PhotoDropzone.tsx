import { ImageIcon, Loader2, Upload, X } from 'lucide-react';
import { useId, useState } from 'react';
import {
  PHOTO_MAX_BYTES,
  PHOTO_MIME_TYPES,
  validatePhotoFile,
  type PhotoUploadError,
} from '../lib/cloudStorage';
import PhotoExpandOverlay from './PhotoExpandOverlay';

interface PhotoDropzoneProps {
  url: string | undefined;
  onUpload: (file: File) => Promise<void>;
  onRemove: () => Promise<void>;
  disabled?: boolean;
  disabledHint?: string;
  label: string;
}

function errorMessage(error: PhotoUploadError): string {
  switch (error.kind) {
    case 'unsupportedType':
      return 'Use JPG, PNG, or WebP.';
    case 'tooLarge':
      return `Too large — keep under ${Math.round(PHOTO_MAX_BYTES / (1024 * 1024))}MB.`;
    case 'notSignedIn':
      return 'Sign in to add photos.';
    case 'storageUnavailable':
      return 'Photo storage unavailable right now.';
    case 'failed':
      return error.message || 'Upload failed.';
  }
}

export default function PhotoDropzone({
  url,
  onUpload,
  onRemove,
  disabled = false,
  disabledHint,
  label,
}: PhotoDropzoneProps) {
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const handleFile = async (file: File | null | undefined) => {
    if (!file || busy) return;
    setError(null);
    const validation = validatePhotoFile(file);
    if (validation) {
      setError(errorMessage(validation));
      return;
    }
    setBusy(true);
    try {
      await onUpload(file);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onRemove();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Remove failed.');
    } finally {
      setBusy(false);
    }
  };

  if (url) {
    return (
      <>
        <div className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white">
          <img
            src={url}
            alt={label}
            onDoubleClick={() => setExpanded(true)}
            className="block max-h-48 w-full cursor-zoom-in object-contain"
          />
          <button
            type="button"
            onClick={handleRemove}
            disabled={busy}
            title="Remove photo"
            className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/95 text-rose-600 opacity-0 shadow ring-1 ring-rose-200 transition hover:bg-rose-50 focus:opacity-100 disabled:cursor-not-allowed disabled:opacity-50 group-hover:opacity-100"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
          </button>
        </div>
        {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
        {expanded && <PhotoExpandOverlay url={url} onClose={() => setExpanded(false)} />}
      </>
    );
  }

  const acceptString = PHOTO_MIME_TYPES.join(',');

  return (
    <>
      <label
        htmlFor={disabled ? undefined : inputId}
        className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-xs transition ${
          disabled
            ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
            : 'cursor-pointer border-slate-300 bg-white text-slate-500 hover:border-sky-300 hover:text-slate-700'
        }`}
      >
        {busy ? (
          <Loader2 size={14} className="shrink-0 animate-spin" />
        ) : disabled ? (
          <ImageIcon size={14} className="shrink-0" />
        ) : (
          <Upload size={14} className="shrink-0" />
        )}
        <span className="truncate">
          {disabled
            ? disabledHint ?? 'Sign in to add a photo.'
            : busy
              ? 'Uploading…'
              : `Click to add a photo for ${label}.`}
        </span>
        <input
          id={inputId}
          type="file"
          accept={acceptString}
          className="hidden"
          disabled={disabled || busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            void handleFile(file);
            event.target.value = '';
          }}
        />
      </label>
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </>
  );
}
