import { ChevronLeft, ChevronRight, ExternalLink, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { NoteCard } from '../types';
import {
  composeNoteContent,
  ensureMarkers,
  processEditorBody,
  splitNoteContent,
} from '../lib/noteLinks';
import PhotoDropzone from './PhotoDropzone';
import { auth } from '../lib/firebase';
import { deletePhoto, notePhotoPath, uploadPhoto } from '../lib/cloudStorage';

interface NoteCardsProps {
  notes: NoteCard[];
  onChange: (notes: NoteCard[]) => void;
  placeholder?: string;
  /** Required for photo uploads — when omitted, photo dropzone is hidden. */
  mapId?: string | null;
  primitiveId?: string;
  focusedIndex?: number | null;
  notePhotoPathFactory?: (uid: string, mapId: string, noteId: string) => string;
  showPriorityControl?: boolean;
}

function generateNoteId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const NOTE_HEIGHT_STORAGE_KEY = 'diagram-note-note-height';

function loadSavedHeight() {
  if (typeof window === 'undefined') return 128;
  const raw = Number(window.localStorage.getItem(NOTE_HEIGHT_STORAGE_KEY));
  return Number.isFinite(raw) ? Math.max(96, raw) : 128;
}

function ensurePriorityNote(notes: NoteCard[]) {
  if (notes.length === 0) return notes;
  if (notes.some((note) => note.isPriority === true)) return notes;
  return notes.map((note, index) => ({
    ...note,
    isPriority: index === 0,
  }));
}

export default function NoteCards({
  notes,
  onChange,
  mapId,
  primitiveId,
  focusedIndex = null,
  notePhotoPathFactory,
  showPriorityControl = true,
}: NoteCardsProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [currentIndex, setCurrentIndex] = useState(Math.max(0, notes.length - 1));
  const [noteHeight, setNoteHeight] = useState(loadSavedHeight);
  const [editorDraft, setEditorDraft] = useState('');
  const [pendingFocusNoteId, setPendingFocusNoteId] = useState<string | null>(null);

  useEffect(() => {
    if (notes.length === 0) {
      setCurrentIndex(0);
      return;
    }
    if (currentIndex >= notes.length) {
      setCurrentIndex(notes.length - 1);
    }
  }, [notes, notes.length, currentIndex]);

  useEffect(() => {
    if (focusedIndex === null || notes.length === 0) return;
    setCurrentIndex(Math.max(0, Math.min(focusedIndex, notes.length - 1)));
  }, [focusedIndex, notes.length]);

  useLayoutEffect(() => {
    if (!pendingFocusNoteId) return;
    const nextIndex = notes.findIndex((note) => note.id === pendingFocusNoteId);
    if (nextIndex === -1) return;

    setCurrentIndex(nextIndex);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
    setPendingFocusNoteId(null);
  }, [notes, pendingFocusNoteId]);

  const currentNote = notes[currentIndex];
  const currentContent = notes.length > 0 ? currentNote?.content ?? '' : editorDraft;
  const currentParsed = splitNoteContent(currentContent);
  const clickableUrls = currentParsed.urls;

  useEffect(() => {
    setEditorDraft(ensureMarkers(currentParsed.body, currentParsed.urls));
  }, [currentIndex, currentContent]);

  const handlePrev = () => setCurrentIndex((i) => Math.max(0, i - 1));
  const handleNext = () => setCurrentIndex((i) => Math.min(notes.length - 1, i + 1));

  const normalizeNotes = (nextNotes: NoteCard[]) =>
    showPriorityControl
      ? ensurePriorityNote(nextNotes)
      : nextNotes.map((note) => ({ ...note, isPriority: undefined }));

  const handleAdd = () => {
    const newNote: NoteCard = { id: generateNoteId(), name: '', content: '' };
    const nextNotes = normalizeNotes([...notes, newNote]);
    onChange(nextNotes);
    setEditorDraft('');
    setCurrentIndex(nextNotes.length - 1);
    setPendingFocusNoteId(newNote.id ?? null);
  };

  const handleDelete = () => {
    if (notes.length === 0) return;
    const nextNotes = normalizeNotes(notes.filter((_, i) => i !== currentIndex));
    onChange(nextNotes);
    const nextIndex = Math.max(0, Math.min(currentIndex, nextNotes.length - 1));
    setCurrentIndex(nextIndex);
    if (nextNotes.length === 0) {
      setEditorDraft('');
    }
  };

  const handleTogglePriority = () => {
    if (notes.length === 0) return;
    const nextPriority = currentNote?.isPriority !== true;
    const nextNotes = notes.map((note, index) => ({
      ...note,
      isPriority: index === currentIndex ? nextPriority : false,
    }));
    onChange(nextNotes);
  };

  const handleUpdateContent = (value: string) => {
    const { body, urls } = processEditorBody(value, editorDraft, currentParsed.urls);
    setEditorDraft(body);
    const nextContent = composeNoteContent(body, urls);
    if (notes.length === 0) {
      onChange(normalizeNotes([{ name: '', content: nextContent, isPriority: true }]));
      setCurrentIndex(0);
      return;
    }
    const nextNotes = normalizeNotes(notes.map((n, i) =>
      i === currentIndex ? { ...n, content: nextContent } : n
    ));
    onChange(nextNotes);
  };

  const persistHeight = () => {
    const nextHeight = textareaRef.current?.offsetHeight;
    if (!nextHeight) return;
    const clamped = Math.max(96, nextHeight);
    setNoteHeight(clamped);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(NOTE_HEIGHT_STORAGE_KEY, String(clamped));
    }
  };

  const updateCurrentNoteContent = (nextContent: string) => {
    if (notes.length === 0) {
      setEditorDraft(splitNoteContent(nextContent).body);
      onChange(normalizeNotes([{ name: '', content: nextContent, isPriority: true }]));
      setCurrentIndex(0);
      return;
    }
    const nextNotes = normalizeNotes(
      notes.map((note, index) =>
        index === currentIndex ? { ...note, content: nextContent } : note
      )
    );
    onChange(nextNotes);
  };

  const handleRemoveUrl = (removeIdx: number) => {
    if (removeIdx < 0 || removeIdx >= clickableUrls.length) return;
    const removeNum = removeIdx + 1;
    const newBody = currentParsed.body.replace(/\[(\d+)\]/g, (match, raw) => {
      const num = parseInt(raw, 10);
      if (num === removeNum) return '';
      if (num > removeNum) return `[${num - 1}]`;
      return match;
    });
    const newUrls = clickableUrls.filter((_, i) => i !== removeIdx);
    updateCurrentNoteContent(composeNoteContent(newBody, newUrls));
  };

  const photosEnabled = Boolean(mapId && (primitiveId || notePhotoPathFactory));
  const uploadNotePhoto = async (file: File) => {
    if (!photosEnabled) return;
    const uid = auth?.currentUser?.uid;
    if (!uid || !mapId || (!primitiveId && !notePhotoPathFactory)) {
      throw new Error('Sign in to add photos.');
    }
    const note = notes[currentIndex];
    if (!note) return;
    const noteId = note.id ?? generateNoteId();
    const path = notePhotoPathFactory
      ? notePhotoPathFactory(uid, mapId, noteId)
      : notePhotoPath(uid, mapId, primitiveId as string, noteId);
    const result = await uploadPhoto(
      path,
      file
    );
    if (!result) {
      throw new Error('Photo storage unavailable right now.');
    }
    const nextNotes = notes.map((n, i) =>
      i === currentIndex
        ? { ...n, id: noteId, photoUrl: result.url, photoStoragePath: result.path }
        : n
    );
    onChange(nextNotes);
  };

  const removeNotePhoto = async () => {
    if (!photosEnabled) return;
    const note = notes[currentIndex];
    if (!note) return;
    if (note.photoStoragePath) {
      await deletePhoto(note.photoStoragePath);
    }
    const nextNotes = notes.map((n, i) =>
      i === currentIndex ? { ...n, photoUrl: undefined, photoStoragePath: undefined } : n
    );
    onChange(nextNotes);
  };

  const renderPhotoDropzone = (withTopMargin = false) =>
    photosEnabled && notes.length > 0 ? (
      <div className={withTopMargin ? 'mt-2' : ''}>
        <PhotoDropzone
          label="this note"
          url={currentNote?.photoUrl}
          disabled={!auth?.currentUser?.uid}
          disabledHint="Sign in to add a photo to this note."
          onUpload={uploadNotePhoto}
          onRemove={removeNotePhoto}
        />
      </div>
    ) : null;

  const renderLinkList = (withTopMargin = false) => (
    <div className={`${withTopMargin ? 'mt-2 ' : ''}space-y-2`}>
      {clickableUrls.map((url, index) => (
        <div
          key={`${index}-${url}`}
          className="group flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2"
        >
          <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-sky-700">
            [{index + 1}]
          </span>
          <button
            type="button"
            onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
            className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-sky-700 transition hover:text-sky-800"
            title={url}
          >
            <ExternalLink size={14} strokeWidth={2.4} className="shrink-0" />
            <span className="truncate">{url}</span>
          </button>
          <button
            type="button"
            onClick={() => handleRemoveUrl(index)}
            className="rounded-full p-0.5 text-gray-400 opacity-0 transition hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
            title="Remove link"
          >
            <X size={12} strokeWidth={2.4} />
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
      <div className="flex items-center justify-between gap-2">
        {showPriorityControl ? (
          <button
            type="button"
            onClick={handleTogglePriority}
            disabled={notes.length === 0}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] transition ${
              currentNote?.isPriority === true
                ? 'border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200'
                : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-100'
            } disabled:cursor-default disabled:opacity-50`}
            title="Mark this note as the priority note"
          >
            Priority
          </button>
        ) : (
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Notes
          </div>
        )}
        <div className="flex items-center gap-1">
          {notes.length > 0 && (
            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">
              {currentIndex + 1}/{notes.length}
            </span>
          )}
          <button
            onClick={handlePrev}
            disabled={currentIndex <= 0 || notes.length === 0}
            className="inline-flex items-center rounded-full border border-slate-200 bg-white p-1 text-slate-600 transition hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-white"
            title="Previous note"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={handleNext}
            disabled={currentIndex >= notes.length - 1 || notes.length === 0}
            className="inline-flex items-center rounded-full border border-slate-200 bg-white p-1 text-slate-600 transition hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-white"
            title="Next note"
          >
            <ChevronRight size={14} />
          </button>
          <button
            onClick={handleAdd}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100"
            title="Add note"
          >
            <Plus size={12} />
            Add
          </button>
          {notes.length > 0 && (
            <button
              onClick={handleDelete}
              className="inline-flex items-center rounded-full border border-rose-200 bg-white p-1 text-rose-600 transition hover:bg-rose-50"
              title="Delete note"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {notes.length > 0 ? (
        <div className="mt-2 space-y-2">
          <textarea
            ref={textareaRef}
            value={editorDraft}
            onChange={(event) => handleUpdateContent(event.target.value)}
            onMouseUp={persistHeight}
            onTouchEnd={persistHeight}
            onBlur={persistHeight}
            placeholder=""
            style={{ height: `${noteHeight}px` }}
            rows={4}
            className="min-h-24 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-sky-300"
          />
          {clickableUrls.length > 0 && renderLinkList()}
          {renderPhotoDropzone()}
        </div>
      ) : (
        <div className="mt-2">
          <textarea
            ref={textareaRef}
            value={editorDraft}
            onChange={(event) => handleUpdateContent(event.target.value)}
            onMouseUp={persistHeight}
            onTouchEnd={persistHeight}
            onBlur={persistHeight}
            placeholder=""
            style={{ height: `${noteHeight}px` }}
            rows={4}
            className="min-h-24 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-sky-300"
          />
          {clickableUrls.length > 0 && renderLinkList(true)}
        </div>
      )}
    </div>
  );
}
