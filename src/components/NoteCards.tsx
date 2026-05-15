import { ChevronLeft, ChevronRight, ExternalLink, Link2, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { NoteCard } from '../types';
import { composeNoteContent, openUrlsInTabs, splitNoteContent } from '../lib/noteLinks';

interface NoteCardsProps {
  notes: NoteCard[];
  onChange: (notes: NoteCard[]) => void;
  placeholder?: string;
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
  placeholder = 'Link',
}: NoteCardsProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [currentIndex, setCurrentIndex] = useState(Math.max(0, notes.length - 1));
  const [noteHeight, setNoteHeight] = useState(loadSavedHeight);
  const [emptyDraft, setEmptyDraft] = useState('');

  useEffect(() => {
    if (notes.length === 0) {
      setCurrentIndex(0);
      setEmptyDraft('');
      return;
    }
    if (currentIndex >= notes.length) {
      setCurrentIndex(notes.length - 1);
    }
    setEmptyDraft('');
  }, [notes, notes.length, currentIndex]);

  const currentNote = notes[currentIndex];
  const currentContent = notes.length > 0 ? currentNote?.content ?? '' : emptyDraft;
  const currentParsed = splitNoteContent(currentContent);
  const clickableUrls = currentParsed.urls;

  const handlePrev = () => setCurrentIndex((i) => Math.max(0, i - 1));
  const handleNext = () => setCurrentIndex((i) => Math.min(notes.length - 1, i + 1));

  const handleAdd = () => {
    const nextNotes = ensurePriorityNote([...notes, { name: '', content: '' }]);
    onChange(nextNotes);
    setCurrentIndex(nextNotes.length - 1);
  };

  const handleDelete = () => {
    if (notes.length === 0) return;
    const nextNotes = ensurePriorityNote(notes.filter((_, i) => i !== currentIndex));
    onChange(nextNotes);
    const nextIndex = Math.max(0, Math.min(currentIndex, nextNotes.length - 1));
    setCurrentIndex(nextIndex);
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
    const nextParsed = splitNoteContent(value);
    if (notes.length === 0) {
      const mergedUrls = Array.from(new Set(nextParsed.urls));
      const nextContent = composeNoteContent(nextParsed.body, mergedUrls);
      setEmptyDraft(nextContent);
      onChange([{ name: '', content: nextContent, isPriority: true }]);
      setCurrentIndex(0);
      return;
    }
    const mergedUrls = Array.from(new Set([...currentParsed.urls, ...nextParsed.urls]));
    const nextContent = composeNoteContent(nextParsed.body, mergedUrls);
    const nextNotes = ensurePriorityNote(notes.map((n, i) =>
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

  const linkTitle =
    clickableUrls.length > 1 ? `Open ${clickableUrls.length} links` : 'Open link';

  const handleRemoveLinks = () => {
    const nextContent = composeNoteContent(currentParsed.body, []);
    if (notes.length === 0) {
      setEmptyDraft(nextContent);
      onChange([{ name: '', content: nextContent, isPriority: true }]);
      setCurrentIndex(0);
      return;
    }
    const nextNotes = ensurePriorityNote(
      notes.map((note, index) =>
        index === currentIndex ? { ...note, content: nextContent } : note
      )
    );
    onChange(nextNotes);
  };

  const renderLinkAction = (withTopMargin = false) => (
    <div className={`${withTopMargin ? 'mt-2 ' : ''}group inline-flex items-center gap-1`}>
      <button
        type="button"
        onClick={() => openUrlsInTabs(clickableUrls)}
        className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100"
        title={linkTitle}
      >
        <ExternalLink size={13} strokeWidth={2.4} />
        {clickableUrls.length > 1 && <span>{clickableUrls.length}</span>}
      </button>
      <button
        type="button"
        onClick={handleRemoveLinks}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-rose-200 bg-white text-rose-500 opacity-0 transition hover:bg-rose-50 hover:text-rose-600 focus:opacity-100 group-hover:opacity-100"
        title={clickableUrls.length > 1 ? 'Remove links' : 'Remove link'}
      >
        <X size={12} strokeWidth={2.4} />
      </button>
    </div>
  );

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
      <div className="flex items-center justify-between gap-2">
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
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={currentParsed.body}
              onChange={(event) => handleUpdateContent(event.target.value)}
              onMouseUp={persistHeight}
              onTouchEnd={persistHeight}
              onBlur={persistHeight}
              placeholder=""
              style={{ height: `${noteHeight}px` }}
              rows={4}
              className="min-h-24 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-sky-300"
            />
            {!currentContent.trim() && (
              <div className="pointer-events-none absolute left-3 top-2.5 inline-flex items-center gap-2 text-sm text-slate-400">
                <Link2 size={14} />
                <span>{placeholder}</span>
              </div>
            )}
          </div>
          {clickableUrls.length > 0 && renderLinkAction()}
        </div>
      ) : (
        <div className="mt-2">
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={currentParsed.body}
              onChange={(event) => handleUpdateContent(event.target.value)}
              onMouseUp={persistHeight}
              onTouchEnd={persistHeight}
              onBlur={persistHeight}
              placeholder=""
              style={{ height: `${noteHeight}px` }}
              rows={4}
              className="min-h-24 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-sky-300"
            />
            {!currentContent.trim() && (
              <div className="pointer-events-none absolute left-3 top-2.5 inline-flex items-center gap-2 text-sm text-slate-400">
                <Link2 size={14} />
                <span>{placeholder}</span>
              </div>
            )}
          </div>
          {clickableUrls.length > 0 && renderLinkAction(true)}
        </div>
      )}
    </div>
  );
}
