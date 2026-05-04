import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { NoteCard } from '../types';

interface NoteCardsProps {
  notes: NoteCard[];
  onChange: (notes: NoteCard[]) => void;
  placeholder?: string;
}

export default function NoteCards({
  notes,
  onChange,
  placeholder = 'Write a note snippet...',
}: NoteCardsProps) {
  const [currentIndex, setCurrentIndex] = useState(Math.max(0, notes.length - 1));
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  useEffect(() => {
    if (notes.length === 0) {
      setCurrentIndex(0);
      return;
    }
    if (currentIndex >= notes.length) {
      setCurrentIndex(notes.length - 1);
    }
  }, [notes.length, currentIndex]);

  const currentNote = notes[currentIndex];

  const handlePrev = () => setCurrentIndex((i) => Math.max(0, i - 1));
  const handleNext = () => setCurrentIndex((i) => Math.min(notes.length - 1, i + 1));

  const handleAdd = () => {
    const nextNotes = [...notes, { name: '', content: '' }];
    onChange(nextNotes);
    setCurrentIndex(nextNotes.length - 1);
    setEditingName(false);
  };

  const handleDelete = () => {
    if (notes.length === 0) return;
    const nextNotes = notes.filter((_, i) => i !== currentIndex);
    onChange(nextNotes);
    const nextIndex = Math.max(0, Math.min(currentIndex, nextNotes.length - 1));
    setCurrentIndex(nextIndex);
    setEditingName(false);
  };

  const handleUpdateContent = (value: string) => {
    const nextNotes = notes.map((n, i) =>
      i === currentIndex ? { ...n, content: value } : n
    );
    onChange(nextNotes);
  };

  const startEditName = () => {
    if (!currentNote) return;
    setNameDraft(currentNote.name);
    setEditingName(true);
  };

  const saveName = () => {
    const trimmed = nameDraft.trim();
    const nextNotes = notes.map((n, i) =>
      i === currentIndex ? { ...n, name: trimmed } : n
    );
    onChange(nextNotes);
    setEditingName(false);
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Note
        </div>
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
          {editingName ? (
            <input
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={saveName}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  saveName();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setEditingName(false);
                }
              }}
              autoFocus
              placeholder="Note name"
              className="w-full rounded-lg border border-gray-200 px-2.5 py-1 text-sm font-semibold text-gray-900 outline-none focus:border-sky-300"
            />
          ) : (
            <button
              onDoubleClick={startEditName}
              className="block w-full truncate rounded-lg px-1 py-0.5 text-left text-sm font-semibold text-gray-900 transition hover:bg-gray-100"
              title="Double-click to edit name"
            >
              {currentNote?.name || (
                <span className="text-gray-400 font-normal">Untitled note</span>
              )}
            </button>
          )}
          <textarea
            value={currentNote?.content ?? ''}
            onChange={(event) => handleUpdateContent(event.target.value)}
            placeholder={placeholder}
            className="min-h-20 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-sky-300"
          />
        </div>
      ) : (
        <div className="mt-2 rounded-xl border border-dashed border-slate-300 bg-white/60 px-3 py-4 text-center text-xs text-slate-400">
          No notes yet. Click <span className="font-semibold text-slate-500">+ Add</span>{' '}
          to create one.
        </div>
      )}
    </div>
  );
}
