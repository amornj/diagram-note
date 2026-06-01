import { ChevronDown, ChevronRight, PanelRightClose, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { auth } from '../lib/firebase';
import { deletePhoto, mapNotePhotoPath, mapPhotoPath, uploadPhoto } from '../lib/cloudStorage';
import { useEditorStore } from '../lib/store';
import { useMapStore } from '../lib/mapStore';
import type { DiagramMap, NoteCard } from '../types';
import type { RelatedTarget } from '../lib/workspace';
import { resolveBacklinks, resolveSoftLinks } from '../lib/backlinks';
import NoteCards from './NoteCards';
import PhotoDropzone from './PhotoDropzone';
import CopyDeepLinkButton from './CopyDeepLinkButton';

export default function MapDetailPanel({
  map,
  onStartBacklinkPick,
  backlinkPickActive = false,
  onOpenBacklink,
}: {
  map: DiagramMap;
  onStartBacklinkPick?: () => void;
  backlinkPickActive?: boolean;
  onOpenBacklink?: (args: { target: RelatedTarget; openInSplit: boolean }) => void;
}) {
  const toggleRightPane = useEditorStore((s) => s.toggleRightPane);
  const pendingMapNoteFocus = useEditorStore((s) => s.pendingMapNoteFocus);
  const setPendingMapNoteFocus = useEditorStore((s) => s.setPendingMapNoteFocus);
  const setSelectedPrimitiveId = useEditorStore((s) => s.setSelectedPrimitiveId);
  const openMapOverview = useEditorStore((s) => s.openMapOverview);
  const patchMapDetails = useMapStore((s) => s.patchMapDetails);
  const maps = useMapStore((s) => s.maps);
  const setActiveMap = useMapStore((s) => s.setActiveMap);
  const setActivePage = useMapStore((s) => s.setActivePage);
  const addBacklink = useMapStore((s) => s.addBacklink);
  const removeBacklink = useMapStore((s) => s.removeBacklink);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(map.name);
  const [focusedNoteIndex, setFocusedNoteIndex] = useState<number | null>(null);
  const [deletingBacklinks, setDeletingBacklinks] = useState(false);
  const [backlinksCollapsed, setBacklinksCollapsed] = useState(false);
  const [softLinksCollapsed, setSoftLinksCollapsed] = useState(true);
  const [softLinkAddMode, setSoftLinkAddMode] = useState(false);
  const sourceTarget: RelatedTarget = { kind: 'map', mapId: map.id };
  const relatedMembers = useMemo(
    () => resolveBacklinks({ keys: map.relatedMemberKeys ?? [], maps, fallbackMap: map }),
    [map, maps]
  );
  const softLinks = useMemo(
    () => resolveSoftLinks({ source: { kind: 'map', map }, maps }),
    [map, maps]
  );

  useEffect(() => {
    setNameDraft(map.name);
    setEditingName(false);
  }, [map.id, map.name]);

  useEffect(() => {
    setFocusedNoteIndex(null);
  }, [map.id]);

  useEffect(() => {
    if (!pendingMapNoteFocus || pendingMapNoteFocus.mapId !== map.id) return;
    setFocusedNoteIndex(pendingMapNoteFocus.noteIndex);
    setPendingMapNoteFocus(null);
  }, [map.id, pendingMapNoteFocus, setPendingMapNoteFocus]);

  const saveName = (nextName = nameDraft) => {
    const trimmed = nextName.trim();
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

  const promoteSoftLink = async (target: RelatedTarget) => {
    const added = await addBacklink(sourceTarget, target);
    if (!added) return;
    setSoftLinkAddMode(false);
    if (backlinkPickActive) onStartBacklinkPick?.();
  };

  const openBacklink = async (target: RelatedTarget, openInSplit: boolean) => {
    if (onOpenBacklink) {
      onOpenBacklink({ target, openInSplit });
      return;
    }
    if (target.kind === 'map') {
      if (openInSplit) {
        window.dispatchEvent(new CustomEvent('map-open-in-split', { detail: { mapId: target.mapId } }));
      } else {
        await setActiveMap(target.mapId);
        openMapOverview();
      }
      return;
    }
    if (!target.mapId || target.pageIndex === null) return;
    if (openInSplit) {
      window.dispatchEvent(
        new CustomEvent('map-open-in-split', {
          detail: {
            mapId: target.mapId,
            pageIndex: target.pageIndex,
            primitiveId: target.id,
          },
        })
      );
      return;
    }
    await setActiveMap(target.mapId);
    await setActivePage(target.pageIndex);
    setSelectedPrimitiveId(target.id);
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden border-l border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-sky-100 bg-sky-50 px-4 py-3">
        {editingName ? (
          <input
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={(event) => saveName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                saveName(event.currentTarget.value);
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
        <div className="flex items-center gap-1">
          <CopyDeepLinkButton
            mapId={map.id}
            label="Copy map link"
          />
          <button
            onClick={toggleRightPane}
            className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100"
            title="Hide right pane (2)"
          >
            <PanelRightClose size={18} />
          </button>
        </div>
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
          focusedIndex={focusedNoteIndex}
          notePhotoPathFactory={mapNotePhotoPath}
          showPriorityControl={false}
        />

        <div>
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setBacklinksCollapsed((value) => !value)}
              className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-gray-500 transition hover:text-gray-700"
            >
              {backlinksCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              <span>Backlinks</span>
              {relatedMembers.length > 0 && (
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] tracking-normal text-slate-500">
                  {relatedMembers.length}
                </span>
              )}
            </button>
            {onStartBacklinkPick && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setDeletingBacklinks(false);
                    onStartBacklinkPick();
                  }}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                    backlinkPickActive
                      ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {backlinkPickActive ? <X size={12} /> : <Plus size={12} />}
                  {backlinkPickActive ? 'Cancel pick' : 'Add'}
                </button>
                {relatedMembers.length > 0 && (
                  <button
                    onClick={() => setDeletingBacklinks((value) => !value)}
                    className="inline-flex items-center rounded-full border border-rose-200 bg-white p-1 text-rose-600 transition hover:bg-rose-50"
                    aria-label={deletingBacklinks ? 'Stop deleting backlinks' : 'Delete backlinks'}
                    title="Delete backlinks"
                  >
                    {deletingBacklinks ? <X size={14} /> : <Trash2 size={14} />}
                  </button>
                )}
              </div>
            )}
          </div>
          {backlinkPickActive && (
            <div className="mt-1 text-xs text-gray-500">
              Click a primitive or map name in the other window to backlink it.
            </div>
          )}
          {!backlinksCollapsed && (
            relatedMembers.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {relatedMembers.map((member) => (
                  <div
                    key={member.key}
                    className={`group inline-flex items-center rounded-full border py-1 text-xs font-medium transition ${
                      deletingBacklinks
                        ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                        : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100'
                    } ${deletingBacklinks ? 'px-2.5' : 'pl-2.5 pr-1'}`}
                  >
                    <button
                      onClick={(event) => {
                        if (deletingBacklinks) {
                          event.preventDefault();
                          event.stopPropagation();
                          setDeletingBacklinks(false);
                          void removeBacklink(sourceTarget, member.target);
                          return;
                        }
                        void openBacklink(member.target, event.shiftKey);
                      }}
                      className={deletingBacklinks ? '' : 'mr-1'}
                    >
                      <span
                        className={
                          member.kind === 'map'
                            ? 'rounded-full bg-sky-50 px-2 py-0.5 text-sky-700'
                            : ''
                        }
                      >
                        {member.label}
                      </span>
                      {member.detail && (
                        <span className="ml-1 text-[10px] font-normal text-gray-400">
                          {member.detail}
                        </span>
                      )}
                    </button>
                    {!deletingBacklinks && (
                      <button
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void removeBacklink(sourceTarget, member.target);
                        }}
                        className="rounded-full p-0.5 text-gray-400 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                        aria-label={`Remove ${member.label}`}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-xs text-gray-400">No backlinks added yet.</div>
            )
          )}
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setSoftLinksCollapsed((value) => !value)}
              className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-gray-500 transition hover:text-gray-700"
            >
              {softLinksCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              <span>Softlinks</span>
              {softLinks.length > 0 && (
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] tracking-normal text-slate-500">
                  {softLinks.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setSoftLinkAddMode((value) => !value)}
              disabled={softLinks.length === 0}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                softLinkAddMode
                  ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
              } disabled:cursor-default disabled:opacity-40`}
            >
              {softLinkAddMode ? <X size={12} /> : <Plus size={12} />}
              {softLinkAddMode ? 'Cancel add' : 'Add'}
            </button>
          </div>
          {!softLinksCollapsed && (
            softLinks.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {softLinks.map((member) => (
                  <button
                    key={member.key}
                    type="button"
                    onClick={(event) => {
                      if (softLinkAddMode || backlinkPickActive) {
                        event.preventDefault();
                        void promoteSoftLink(member.target);
                        return;
                      }
                      void openBacklink(member.target, event.shiftKey);
                    }}
                    className="inline-flex items-center rounded-full border border-dashed border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                  >
                    <span
                      className={
                        member.kind === 'map'
                          ? 'rounded-full bg-sky-50 px-2 py-0.5 text-sky-700'
                          : ''
                      }
                    >
                      {member.label}
                    </span>
                    {member.detail && (
                      <span className="ml-1 text-[10px] font-normal text-gray-400">
                        {member.detail}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-xs text-gray-400">No soft links found.</div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
