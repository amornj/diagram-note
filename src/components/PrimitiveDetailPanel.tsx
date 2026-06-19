import { ChevronDown, ChevronRight, PanelRightClose, Plus, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useEditorStore } from '../lib/store';
import { useMapStore } from '../lib/mapStore';
import {
  getGroupMemberKeys,
  getPrimitiveBounds,
  getRelatedMemberKeys,
  normalizeTagInput,
  parseMemberKey,
  type RelatedTarget,
} from '../lib/workspace';
import { resolveBacklinks, resolveSoftLinks } from '../lib/backlinks';
import type { MapWorkspace, Primitive } from '../types';
import { ColorPicker, TagEditor } from './sharedControls';
import NoteCards from './NoteCards';
import PhotoDropzone from './PhotoDropzone';
import { auth } from '../lib/firebase';
import {
  deletePhoto,
  primitivePhotoPath,
  uploadPhoto,
} from '../lib/cloudStorage';
import PubChemSearchButton from './PubChemSearchButton';

const KIND_LABELS: Record<Primitive['kind'], string> = {
  rectangle: 'Study box',
  polygon: 'Region',
  customline: 'Polyline',
  group: 'Group',
};

export default function PrimitiveDetailPanel({
  primitive,
  workspaceOverride,
  mapIdOverride,
  pageIndexOverride,
  onSelectPrimitiveOverride,
  onPatchPrimitive,
  onDeletePrimitive,
  onStartCrossPaneBacklinkPick,
  onOpenBacklink,
  paneLabel,
  crossPaneBacklinkPickActive = false,
}: {
  primitive: Primitive;
  workspaceOverride?: MapWorkspace | null;
  mapIdOverride?: string | null;
  pageIndexOverride?: number;
  onSelectPrimitiveOverride?: (primitiveId: string) => void;
  onPatchPrimitive?: (id: string, patch: Partial<Primitive>) => void;
  onDeletePrimitive?: (id: string) => void;
  onStartCrossPaneBacklinkPick?: () => void;
  onOpenBacklink?: (args: {
    target: RelatedTarget;
    openInSplit: boolean;
  }) => void;
  paneLabel?: string | null;
  crossPaneBacklinkPickActive?: boolean;
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
  const pendingPrimitiveNoteFocus = useEditorStore((s) => s.pendingPrimitiveNoteFocus);
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
  const effectiveMapId = mapIdOverride ?? activeMapId;
  const effectiveMap = maps.find((m) => m.id === effectiveMapId) ?? activeMap;
  const effectivePageIndex = pageIndexOverride ?? activeMap?.pageIndex ?? 0;
  const effectiveWorkspace = workspaceOverride ?? workspace;
  const setActiveMap = useMapStore((s) => s.setActiveMap);
  const setActivePage = useMapStore((s) => s.setActivePage);
  const addBacklink = useMapStore((s) => s.addBacklink);
  const removeBacklink = useMapStore((s) => s.removeBacklink);
  const patchPrimitive = useCallback(
    (id: string, patch: Partial<Primitive>) => {
      if (onPatchPrimitive) {
        onPatchPrimitive(id, patch);
      } else {
        updatePrimitive(id, patch);
      }
    },
    [onPatchPrimitive, updatePrimitive]
  );
  const selectPrimitive = useCallback(
    (id: string) => {
      if (onSelectPrimitiveOverride) {
        onSelectPrimitiveOverride(id);
      } else {
        setSelectedPrimitiveId(id);
      }
    },
    [onSelectPrimitiveOverride, setSelectedPrimitiveId]
  );

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(primitive.name);
  const [aliasDraft, setAliasDraft] = useState((primitive.aliases ?? []).join(', '));
  const [draggedGroupIndex, setDraggedGroupIndex] = useState<number | null>(null);
  const [deletingBacklinks, setDeletingBacklinks] = useState(false);
  const [backlinksCollapsed, setBacklinksCollapsed] = useState(false);
  const [softLinksCollapsed, setSoftLinksCollapsed] = useState(true);
  const [softLinkAddMode, setSoftLinkAddMode] = useState(false);
  const focusedNoteIndex =
    pendingPrimitiveNoteFocus?.primitiveId === primitive.id
      ? pendingPrimitiveNoteFocus.noteIndex
      : null;
  const primitivesById = useMemo(
    () => new Map(effectiveWorkspace.primitives.map((p) => [p.id, p])),
    [effectiveWorkspace.primitives]
  );

  const sourceTarget: RelatedTarget | null = effectiveMap
    ? { kind: 'primitive', mapId: effectiveMap.id, pageIndex: effectivePageIndex, id: primitive.id }
    : null;
  const relatedMembers = useMemo(
    () =>
      resolveBacklinks({
        keys: getRelatedMemberKeys(primitive),
        maps,
        fallbackMap: effectiveMap,
        fallbackPageIndex: effectivePageIndex,
        fallbackWorkspace: effectiveWorkspace,
      }),
    [primitive, effectiveWorkspace, maps, effectiveMap, effectivePageIndex]
  );
  const softLinks = useMemo(
    () =>
      effectiveMap
        ? resolveSoftLinks({
            source: {
              kind: 'primitive',
              map: effectiveMap,
              pageIndex: effectivePageIndex,
              workspace: effectiveWorkspace,
              primitive,
            },
            maps,
          })
        : [],
    [primitive, effectiveWorkspace, maps, effectiveMap, effectivePageIndex]
  );

  const openBacklink = useCallback(
    async (target: RelatedTarget, openInSplit: boolean) => {
      if (!effectiveMap) return;
      if (onOpenBacklink) {
        onOpenBacklink({ target, openInSplit });
        return;
      }
      if (target.kind === 'map') {
        if (openInSplit && target.mapId !== effectiveMap.id) {
          window.dispatchEvent(new CustomEvent('map-open-in-split', { detail: { mapId: target.mapId } }));
        } else {
          await setActiveMap(target.mapId);
          useEditorStore.getState().openMapOverview();
        }
        return;
      }
      const targetMapId = target.mapId ?? effectiveMap.id;
      const targetMap = maps.find((map) => map.id === targetMapId);
      if (!targetMap || target.pageIndex === null) return;
      if (openInSplit && targetMapId !== effectiveMap.id) {
        window.dispatchEvent(
          new CustomEvent('map-open-in-split', {
            detail: {
              mapId: targetMapId,
              pageIndex: target.pageIndex,
              primitiveId: target.id,
            },
          })
        );
        return;
      }
      if (targetMapId !== effectiveMap.id) {
        await setActiveMap(targetMapId);
      }
      if (target.pageIndex !== targetMap.pageIndex) {
        await setActivePage(target.pageIndex);
      }
      if (targetMapId === effectiveMap.id && target.pageIndex === effectivePageIndex) {
        selectPrimitive(target.id);
      } else {
        setSelectedPrimitiveId(target.id);
      }
    },
    [
      effectiveMap,
      effectivePageIndex,
      maps,
      onOpenBacklink,
      primitive.id,
      selectPrimitive,
      setActiveMap,
      setActivePage,
      setSelectedPrimitiveId,
    ]
  );

  const isPickingRelated = crossPaneBacklinkPickActive || editorMode === 'overlayNeighborPick';
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
    setSoftLinkAddMode(false);
  }, [primitive.id, primitive.name, primitive.aliases]);

  const promoteSoftLink = async (target: RelatedTarget) => {
    if (!sourceTarget) return;
    const added = await addBacklink(sourceTarget, target);
    if (!added) return;
    selectPrimitive(primitive.id);
    setSoftLinkAddMode(false);
    if (isPickingRelated) {
      if (onStartCrossPaneBacklinkPick) {
        onStartCrossPaneBacklinkPick();
      } else {
        cancelNeighborPick();
      }
    }
  };

  const deleteBacklink = async (target: RelatedTarget, fallbackKey: string) => {
    if (effectiveMap) {
      if (sourceTarget) {
        await removeBacklink(sourceTarget, target);
        selectPrimitive(primitive.id);
      }
      return;
    }
    removeNeighborMember(primitive.id, fallbackKey);
  };

  // Auto-focus name input on freshly-created primitives
  useEffect(() => {
    if (pendingNameFocusId !== primitive.id) return;
    setNameDraft(primitive.name);
    setEditingName(true);
    clearPendingNameFocus();
  }, [pendingNameFocusId, primitive.id, primitive.name, clearPendingNameFocus]);

  const saveName = (nextName = nameDraft) => {
    const trimmed = nextName.trim();
    if (trimmed && trimmed !== primitive.name) {
      patchPrimitive(primitive.id, { name: trimmed });
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
      patchPrimitive(primitive.id, { aliases: normalized });
    }
    setAliasDraft(normalized.join(', '));
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden border-l border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
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
                setNameDraft(primitive.name);
                setEditingName(false);
              }
            }}
            autoFocus
            className="min-w-0 flex-1 rounded-md border border-gray-200 px-2 py-1 text-lg font-bold text-gray-900 outline-none focus:border-sky-300"
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
            className="min-w-0 flex-1 truncate text-left text-lg font-bold text-gray-900"
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
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <span>{KIND_LABELS[primitive.kind]}</span>
            {paneLabel && (
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-normal text-slate-600">
                {paneLabel}
              </span>
            )}
          </div>
          <PubChemSearchButton query={primitive.name} />
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
              onChange={(tags) => patchPrimitive(primitive.id, { tags })}
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
              disabled={!auth?.currentUser?.uid || !effectiveMapId}
              disabledHint="Sign in to add a photo."
              onUpload={async (file) => {
                const uid = auth?.currentUser?.uid;
                if (!uid || !effectiveMapId) return;
                const result = await uploadPhoto(
                  primitivePhotoPath(uid, effectiveMapId, primitive.id),
                  file
                );
                if (!result) return;
                patchPrimitive(primitive.id, {
                  photoUrl: result.url,
                  photoStoragePath: result.path,
                });
              }}
              onRemove={async () => {
                if (primitive.photoStoragePath) {
                  await deletePhoto(primitive.photoStoragePath);
                }
                patchPrimitive(primitive.id, {
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
                  patchPrimitive(primitive.id, { showLabel: event.target.checked })
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
                  patchPrimitive(primitive.id, {
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
                patchPrimitive(primitive.id, {
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
          onChange={(notes) => patchPrimitive(primitive.id, { notes })}
          placeholder="Link"
          mapId={effectiveMapId}
          primitiveId={primitive.id}
          focusedIndex={focusedNoteIndex}
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
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setDeletingBacklinks(false);
                  if (isPickingRelated && onStartCrossPaneBacklinkPick) {
                    onStartCrossPaneBacklinkPick();
                  } else if (isPickingRelated) {
                    cancelNeighborPick();
                  } else if (onStartCrossPaneBacklinkPick) {
                    onStartCrossPaneBacklinkPick();
                  } else {
                    startNeighborPick(primitive.id, effectivePageIndex);
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
                          void deleteBacklink(member.target, member.key);
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
                          void deleteBacklink(member.target, member.key);
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
                      if (softLinkAddMode || isPickingRelated) {
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
                const memberPrim = effectiveWorkspace.primitives.find((p) => p.id === member.id);
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
                      selectPrimitive(member.id);
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
              onChange={(color) => patchPrimitive(primitive.id, { color })}
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
                onClick={() => {
                  if (onDeletePrimitive) {
                    onDeletePrimitive(primitive.id);
                  } else {
                    deletePrimitive(primitive.id);
                  }
                }}
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
