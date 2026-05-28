import { PanelRightClose } from 'lucide-react';
import { useEffect, useState } from 'react';
import { auth } from '../lib/firebase';
import { deletePhoto, mapNotePhotoPath, mapPhotoPath, uploadPhoto } from '../lib/cloudStorage';
import { useEditorStore } from '../lib/store';
import { useMapStore } from '../lib/mapStore';
import type { DiagramMap, NoteCard } from '../types';
import NoteCards from './NoteCards';
import PhotoDropzone from './PhotoDropzone';

export default function MapDetailPanel({ map }: { map: DiagramMap }) {
  const toggleRightPane = useEditorStore((s) => s.toggleRightPane);
  const patchMapDetails = useMapStore((s) => s.patchMapDetails);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(map.name);

  useEffect(() => {
    setNameDraft(map.name);
    setEditingName(false);
  }, [map.id, map.name]);

  const saveName = () => {
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== map.name) {
      void patchMapDetails(map.id, { name: trimmed });
    } else {
      setNameDraft(map.name);
    }
    setEditingName(false);
  };

  const patchNotes = (notes: NoteCard[]) => {
    void patchMapDetails(map.id, { notes });
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden border-l border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-sky-100 bg-sky-50 px-4 py-3">
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
                setNameDraft(map.name);
                setEditingName(false);
              }
            }}
            autoFocus
            className="min-w-0 flex-1 rounded-md border border-gray-200 px-2 py-1 text-lg font-bold text-gray-900 outline-none focus:border-sky-300"
          />
        ) : (
          <button
            onDoubleClick={() => {
              setNameDraft(map.name);
              setEditingName(true);
            }}
            className="min-w-0 flex-1 truncate text-left text-lg font-bold text-gray-900"
            title="Double-click to edit map name"
          >
            {map.name}
          </button>
        )}
        <button
          onClick={toggleRightPane}
          className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100"
          title="Hide right pane (2)"
        >
          <PanelRightClose size={18} />
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Map overview
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Photo
          </label>
          <div className="mt-2">
            <PhotoDropzone
              label="this map"
              url={map.photoUrl}
              disabled={!auth?.currentUser?.uid}
              disabledHint="Sign in to add a map photo."
              onUpload={async (file) => {
                const uid = auth?.currentUser?.uid;
                if (!uid) return;
                const result = await uploadPhoto(mapPhotoPath(uid, map.id), file);
                if (!result) return;
                await patchMapDetails(map.id, {
                  photoUrl: result.url,
                  photoStoragePath: result.path,
                });
              }}
              onRemove={async () => {
                if (map.photoStoragePath) {
                  await deletePhoto(map.photoStoragePath);
                }
                await patchMapDetails(map.id, {
                  photoUrl: undefined,
                  photoStoragePath: undefined,
                });
              }}
            />
          </div>
        </div>

        <NoteCards
          key={map.id}
          notes={map.notes ?? []}
          onChange={patchNotes}
          mapId={map.id}
          notePhotoPathFactory={mapNotePhotoPath}
          showPriorityControl={false}
        />
      </div>
    </div>
  );
}
