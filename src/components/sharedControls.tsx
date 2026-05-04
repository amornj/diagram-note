import { Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { uniqueTags } from '../lib/workspace';

export const COLOR_SWATCHES = ['#fb7185', '#f59e0b', '#22c55e', '#06b6d4', '#8b5cf6'];

interface TagEditorProps {
  userTags: string[];
  onChange: (tags: string[]) => void;
}

export function TagEditor({ userTags, onChange }: TagEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
  }, [editing]);

  const addTag = () => {
    const next = draft.trim();
    if (!next) {
      setEditing(false);
      setDraft('');
      return;
    }
    onChange(uniqueTags([...userTags, next]));
    setDraft('');
    setEditing(false);
  };

  const removeTag = (tag: string) => {
    onChange(userTags.filter((entry) => entry !== tag));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {userTags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700"
          >
            {tag}
            <button
              onClick={() => removeTag(tag)}
              className="rounded-full text-sky-500 transition hover:bg-sky-100 hover:text-sky-700"
              aria-label={`Remove ${tag}`}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <button
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
        >
          <Plus size={12} />
          Add tag
        </button>
      </div>
      {editing && (
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={addTag}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addTag();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setDraft('');
                setEditing(false);
              }
            }}
            placeholder="Add a tag"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-sky-300"
          />
        </div>
      )}
    </div>
  );
}

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  return (
    <div className="flex gap-2">
      {COLOR_SWATCHES.map((color) => (
        <button
          key={color}
          onClick={() => onChange(color)}
          className={`h-8 w-8 rounded-full border-2 transition ${
            value === color ? 'border-slate-900 scale-105' : 'border-white'
          }`}
          style={{ backgroundColor: color }}
          aria-label={`Set color ${color}`}
        />
      ))}
    </div>
  );
}
