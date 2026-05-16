import { PanelRightClose, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useEditorStore } from '../lib/store';
import { useMapStore } from '../lib/mapStore';
import {
  getGroupMemberKeys,
  getPrimitiveBounds,
  getRelatedMemberKeys,
  parseRelatedPrimitiveKey,
  normalizeTagInput,
  parseMemberKey,
} from '../lib/workspace';
import type { Primitive } from '../types';
import { ColorPicker, TagEditor } from './sharedControls';
import NoteCards from './NoteCards';
import PhotoDropzone from './PhotoDropzone';
import { auth } from '../lib/firebase';
import {
  deletePhoto,
  primitivePhotoPath,
  uploadPhoto,
} from '../lib/cloudStorage';

const KIND_LABELS: Record<Primitive['kind'], string> = {
  rectangle: 'Study box',
  polygon: 'Region',
  customline: 'Polyline',
  group: 'Group',
};

export default function PrimitiveDetailPanel({
  primitive,
  onOpenCrossMapBacklink,
}: {
  primitive: Primitive;
  onOpenCrossMapBacklink?: (args: {
    sourceMapId: string;
    sourcePageIndex: number;
    sourcePrimitiveId: string;
    targetMapId: string;
    targetPageIndex: number;
    targetPrimitiveId: string;
  }) => void;
}) {
  const setSelectedPrimitiveId = useEditorStore((s) => s.setSelectedPrimitiveId);
  const setZoomTarget = useEditorStore((s) => s.setZoomTarget);
  const toggleRightPane = useEditorStore((s) => s.toggleRightPane);
  const updatePrimitive = useEditorStore((s) => s.updatePrimitive);
  const deletePrimitive = useEditorStore((s) => s.deletePrimitive);
  const editorMode = useEditorStore((s) => s.editorMode);
  const workspace = useEditorStore((s) => s.workspace);
  const pendingNameFocusId = useEditorStore((s) => s.pendingNameFocusId);
  const clearPendingNameFocus = useEditorStore((s) => s.clearPendingNameFocus);
  const startNeighborPick = useEditorStore((s) => s.startNeighborPick);
  const cancelNeighborPick = useEditorStore((s) => s.cancelNeighborPick);
  const removeNeighborMember = useEditorStore((s) => s.removeNeighborMember);
  const startGroupMemberPick = useEditorStore((s) => s.startGroupMemberPick);
  const removeGroupMember = useEditorStore((s) => s.removeGroupMember);
  const reorderGroupMember = useEditorStore((s) => s.reorderGroupMember);
  const groupCollectTargetId = useEditorStore((s) => s.groupCollectTargetId);
  const maps = useMapStore((s) => s.maps);
  const activeMapId = useMapStore((s) => s.activeMapId);
  const activeMap = maps.find((m) => m.id === activeMapId) ?? null;
  const setActiveMap = useMapStore((s) => s.setActiveMap);
  const setActivePage = useMapStore((s) => s.setActivePage);
  const removePrimitiveBacklink = useMapStore((s) => s.removePrimitiveBacklink);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(primitive.name);
  const [aliasDraft, setAliasDraft] = useState((primitive.aliases ?? []).join(', '));
  const [draggedGroupIndex, setDraggedGroupIndex] = useState<number | null>(null);
  const [deletingBacklinks, setDeletingBacklinks] = useState(false);
  const primitivesById = useMemo(
    () => new Map(workspace.primitives.map((p) => [p.id, p])),
    [workspace.primitives]
  );

  const relatedMembers = useMemo(
    () =>
      getRelatedMemberKeys(primitive)
        .map((key) => {
          const member = parseRelatedPrimitiveKey(key);
          if (!member) return null;
          const targetMapId = member.mapId ?? activeMap?.id ?? null;
          if (!targetMapId) return null;
          const targetMap = maps.find((map) => map.id === targetMapId);
          if (!targetMap) return null;
          const pageIndex = member.pageIndex ?? targetMap.pageIndex ?? 0;
          const pageWorkspace =
            targetMapId === activeMap?.id && pageIndex === activeMap?.pageIndex
              ? workspace
              : targetMap.pages?.[pageIndex]?.workspace ?? targetMap.workspace;
          const memberPrim = pageWorkspace?.primitives.find((p) => p.id === member.id);
          if (!memberPrim) return null;
          const sameMap = targetMapId === activeMap?.id;
          return {
            key,
            id: member.id,
            mapId: targetMapId,
            mapName: targetMap.name,
            sameMap,
            pageIndex,
            label:
              sameMap && pageIndex === activeMap?.pageIndex
                ? memberPrim.name
                : sameMap
                ? `${memberPrim.name} · Page ${pageIndex + 1}`
                : `${memberPrim.name} · ${targetMap.name}${targetMap.pageCount > 1 ? ` · Page ${pageIndex + 1}` : ''}`,
            onClick: async (openInSplit: boolean) => {
              if (!activeMap) return;
              if (!sameMap) {
                if (openInSplit) {
                  onOpenCrossMapBacklink?.({
                    sourceMapId: activeMap.id,
                    sourcePageIndex: activeMap.pageIndex,
                    sourcePrimitiveId: primitive.id,
                    targetMapId,
                    targetPageIndex: pageIndex,
                    targetPrimitiveId: member.id,
                  });
                } else {
                  await setActiveMap(targetMapId);
                  if (pageIndex !== targetMap.pageIndex) {
                    await setActivePage(pageIndex);
                  }
                  setSelectedPrimitiveId(member.id);
                }
                return;
              }
              if (pageIndex !== activeMap.pageIndex) {
                await setActivePage(pageIndex);
              }
              setSelectedPrimitiveId(member.id);
            },
          };
        })
        .filter((m): m is NonNullable<typeof m> => m !== null)
        .sort((a, b) => {
          if (a.sameMap !== b.sameMap) return a.sameMap ? -1 : 1;
          return a.label.localeCompare(b.label);
        }),
    [
      primitive,
      workspace,
      maps,
      activeMap,
      setActiveMap,
      setActivePage,
      setSelectedPrimitiveId,
      onOpenCrossMapBacklink,
    ]
  );

  const isPickingRelated = editorMode === 'overlayNeighborPick';
  const isPickingGroupItems =
    primitive.kind === 'group' &&
    editorMode === 'groupCollect' &&
    groupCollectTargetId === primitive.id;

  // Reset state when switching primitives
  useEffect(() => {
    setNameDraft(primitive.name);
    setAliasDraft((primitive.aliases ?? []).join(', '));
    setEditingName(false);
    setConfirmDelete(false);
    setDeletingBacklinks(false);
  }, [primitive.id, primitive.name, primitive.aliases]);

  // Auto-focus name input on freshly-created primitives
  useEffect(() => {
    if (pendingNameFocusId !== primitive.id) return;
    setNameDraft(primitive.name);
    setEditingName(true);
    clearPendingNameFocus();
  }, [pendingNameFocusId, primitive.id, primitive.name, clearPendingNameFocus]);

  const saveName = () => {
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== primitive.name) {
      updatePrimitive(primitive.id, { name: trimmed });
    } else {
      setNameDraft(primitive.name);
    }
    setEditingName(false);
  };

  const saveAliases = () => {
    const normalized = normalizeTagInput(aliasDraft);
    const current = primitive.aliases ?? [];
    const unchanged =
      normalized.length === current.length &&
      normalized.every((alias, index) => alias === current[index]);
    if (!unchanged) {
      updatePrimitive(primitive.id, { aliases: normalized });
    }
    setAliasDraft(normalized.join(', '));
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden border-l border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
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
                setNameDraft(primitive.name);
                setEditingName(false);
              }
            }}
            autoFocus
            className="w-full rounded-md border border-gray-200 px-2 py-1 text-lg font-bold text-gray-900 outline-none focus:border-sky-300"
          />
        ) : (
          <button
            onDoubleClick={() => {
              setNameDraft(primitive.name);
              setEditingName(true);
            }}
            onClick={() => {
              setNameDraft(primitive.name);
              setEditingName(true);
            }}
            className="truncate text-left text-lg font-bold text-gray-900"
            title="Click to edit name"
          >
            {primitive.name}
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
          {KIND_LABELS[primitive.kind]}
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Aliases
          </label>
          <input
            value={aliasDraft}
            onChange={(event) => setAliasDraft(event.target.value)}
            onBlur={saveAliases}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                saveAliases();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setAliasDraft((primitive.aliases ?? []).join(', '));
              }
            }}
            placeholder="Other names or abbreviations, separated by commas"
            className="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none transition focus:border-sky-300"
          />
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Tags
          </label>
          <div className="mt-2">
            <TagEditor
              userTags={primitive.tags ?? []}
              onChange={(tags) => updatePrimitive(primitive.id, { tags })}
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Photo
          </label>
          <div className="mt-2">
            <PhotoDropzone
              label="this primitive"
              url={primitive.photoUrl}
              disabled={!auth?.currentUser?.uid || !activeMapId}
              disabledHint="Sign in to add a photo."
              onUpload={async (file) => {
                const uid = auth?.currentUser?.uid;
                if (!uid || !activeMapId) return;
                const result = await uploadPhoto(
                  primitivePhotoPath(uid, activeMapId, primitive.id),
                  file
                );
                if (!result) return;
                updatePrimitive(primitive.id, {
                  photoUrl: result.url,
                  photoStoragePath: result.path,
                });
              }}
              onRemove={async () => {
                if (primitive.photoStoragePath) {
                  await deletePhoto(primitive.photoStoragePath);
                }
                updatePrimitive(primitive.id, {
                  photoUrl: undefined,
                  photoStoragePath: undefined,
                });
              }}
            />
          </div>
        </div>

        <div className="space-y-2">
          {(primitive.kind === 'rectangle' ||
            primitive.kind === 'polygon' ||
            primitive.kind === 'group') && (
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                checked={primitive.showLabel === true}
                onChange={(event) =>
                  updatePrimitive(primitive.id, { showLabel: event.target.checked })
                }
                className="h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500"
              />
              Show label
            </label>
          )}
          {primitive.kind === 'group' && (
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                checked={primitive.showMemberNumbers === true}
                onChange={(event) =>
                  updatePrimitive(primitive.id, {
                    showMemberNumbers: event.target.checked,
                  })
                }
                className="h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500"
              />
              Show member numbers on map
            </label>
          )}
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={primitive.showPriorityNote === true}
              onChange={(event) =>
                updatePrimitive(primitive.id, {
                  showPriorityNote: event.target.checked,
                })
              }
              className="h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500"
            />
              Show priority note
            </label>
        </div>

        <NoteCards
          key={primitive.id}
          notes={primitive.notes ?? []}
          onChange={(notes) => updatePrimitive(primitive.id, { notes })}
          placeholder="Link"
          mapId={activeMapId}
          primitiveId={primitive.id}
        />

        <div>
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Backlinks
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setDeletingBacklinks(false);
                  if (isPickingRelated) {
                    cancelNeighborPick();
                  } else {
                    startNeighborPick(primitive.id, activeMap?.pageIndex ?? 0);
                  }
                }}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                  isPickingRelated
                    ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                {isPickingRelated ? <X size={12} /> : <Plus size={12} />}
                {isPickingRelated ? 'Cancel pick' : 'Add'}
              </button>
              {relatedMembers.length > 0 && (
                <button
                  onClick={() => setDeletingBacklinks((value) => !value)}
                  className={`inline-flex items-center rounded-full border bg-white p-1 transition ${
                    deletingBacklinks
                      ? 'border-rose-200 text-rose-600 hover:bg-rose-50'
                      : 'border-rose-200 text-rose-600 hover:bg-rose-50'
                  }`}
                  aria-label={deletingBacklinks ? 'Stop deleting backlinks' : 'Delete backlinks'}
                  title="Delete backlinks"
                >
                  {deletingBacklinks ? <X size={14} /> : <Trash2 size={14} />}
                </button>
              )}
            </div>
          </div>
          {isPickingRelated && (
            <div className="mt-1 text-xs text-gray-500">
              Click a primitive on the map to backlink it.
            </div>
          )}
          {relatedMembers.length > 0 ? (
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
                        if (activeMap) {
                          void removePrimitiveBacklink(
                            activeMap.id,
                            activeMap.pageIndex,
                            primitive.id,
                            member.mapId,
                            member.pageIndex,
                            member.id
                          );
                          return;
                        }
                        removeNeighborMember(primitive.id, member.key);
                        return;
                      }
                      void member.onClick(event.shiftKey);
                    }}
                    className={deletingBacklinks ? '' : 'mr-1'}
                  >
                    {member.label}
                  </button>
                  {!deletingBacklinks && (
                    <button
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (activeMap) {
                          void removePrimitiveBacklink(
                            activeMap.id,
                            activeMap.pageIndex,
                            primitive.id,
                            member.mapId,
                            member.pageIndex,
                            member.id
                          );
                          return;
                        }
                        removeNeighborMember(primitive.id, member.key);
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
          )}
        </div>

        {primitive.kind === 'group' && (
          <div>
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Group items
              </div>
              <button
                onClick={() =>
                  isPickingGroupItems ? cancelNeighborPick() : startGroupMemberPick(primitive.id)
                }
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                  isPickingGroupItems
                    ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                {isPickingGroupItems ? <X size={12} /> : <Plus size={12} />}
                {isPickingGroupItems ? 'Cancel pick' : 'Add'}
              </button>
            </div>
            {isPickingGroupItems && (
              <div className="mt-1 text-xs text-gray-500">
                Click study boxes or other primitives on the map to add them.
              </div>
            )}
            <div className="mt-2 space-y-1.5">
              {getGroupMemberKeys(primitive).map((memberKey, index) => {
                const member = parseMemberKey(memberKey);
                if (!member) return null;
                const memberPrim = workspace.primitives.find((p) => p.id === member.id);
                if (!memberPrim) return null;
                return (
                  <div
                    key={memberKey}
                    draggable
                    onDragStart={() => setDraggedGroupIndex(index)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (draggedGroupIndex === null) return;
                      reorderGroupMember(primitive.id, draggedGroupIndex, index);
                      setDraggedGroupIndex(null);
                    }}
                    onDragEnd={() => setDraggedGroupIndex(null)}
                    onClick={() => {
                      setSelectedPrimitiveId(member.id);
                      const bbox = getPrimitiveBounds(memberPrim, primitivesById);
                      if (bbox) {
                        setZoomTarget({
                          bbox,
                          immediate: false,
                          padding: 16,
                        });
                      }
                    }}
                    className="group flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 hover:bg-sky-50 hover:border-sky-200 cursor-pointer transition"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                        {index + 1}
                      </span>
                      <span className="truncate text-left">
                        {memberPrim.name}
                      </span>
                    </div>
                    <button
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        removeGroupMember(primitive.id, memberKey);
                      }}
                      className="rounded-full p-1 text-gray-400 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                      aria-label={`Remove ${memberPrim.name}`}
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
              {getGroupMemberKeys(primitive).length === 0 && (
                <div className="text-xs text-gray-400">No group items yet.</div>
              )}
            </div>
          </div>
        )}

        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Color
          </label>
          <div className="mt-2">
            <ColorPicker
              value={primitive.color}
              onChange={(color) => updatePrimitive(primitive.id, { color })}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-red-100 bg-red-50 p-3">
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1 rounded-full bg-red-600 px-3 py-1.5 text-xs font-semibold text-white"
            >
              <Trash2 size={12} />
              Delete {KIND_LABELS[primitive.kind].toLowerCase()}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => deletePrimitive(primitive.id)}
                className="inline-flex items-center gap-1 rounded-full bg-red-600 px-3 py-1.5 text-xs font-semibold text-white"
              >
                <Trash2 size={12} />
                Confirm
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700"
              >
                <X size={12} />
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
