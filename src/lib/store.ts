import { create } from 'zustand';
import type {
  BBox,
  MapWorkspace,
  NoteCard,
  Point,
  Primitive,
} from '../types';
import {
  EMPTY_WORKSPACE,
  getGroupMemberKeys,
  getPrimitiveBounds,
  makeMemberKey,
  makePrimitiveId,
  parseMemberKey,
} from './workspace';

export type EditorMode =
  | 'none'
  | 'textSelect'
  | 'polygon'
  | 'rectangle'
  | 'customline'
  | 'groupCollect'
  | 'overlayNeighborPick';

export type ZoomTarget = { bbox: BBox; immediate?: boolean; lockZoom?: boolean };

export interface EditorState {
  selectedPrimitiveId: string | null;
  hoveredPrimitiveId: string | null;
  workspace: MapWorkspace;
  draftGroupKeys: string[];
  selectedOccurrenceIndex: number;
  editorMode: EditorMode;
  draftOverlayColor: string;
  draftPolygonPoints: Point[];
  draftRectangleStart: Point | null;
  leftSidebarCollapsed: boolean;
  rightPaneOpen: boolean;
  zoomTarget: ZoomTarget | null;
  zoomLocked: boolean;
  spacePanActive: boolean;
  pendingNameFocusId: string | null;
  overlayNeighborTargetId: string | null;
  overlayNeighborTargetPageIndex: number | null;
  groupCollectTargetId: string | null;

  setWorkspace: (workspace: MapWorkspace) => void;
  setSelectedPrimitiveId: (id: string | null) => void;
  setHoveredPrimitiveId: (id: string | null) => void;
  setSelectedOccurrenceIndex: (index: number) => void;
  cycleSelection: (direction: -1 | 1) => boolean;
  toggleLeftSidebar: () => void;
  setLeftSidebarCollapsed: (collapsed: boolean) => void;
  toggleRightPane: () => void;
  setZoomTarget: (target: ZoomTarget | null) => void;
  toggleZoomLock: () => void;
  setSpacePanActive: (active: boolean) => void;
  setEditorMode: (mode: EditorMode) => void;
  setDraftOverlayColor: (color: string) => void;
  addDraftPolygonPoint: (point: Point) => void;
  clearDraftPolygon: () => void;
  setDraftRectangleStart: (point: Point | null) => void;
  addPrimitive: (primitive: Omit<Primitive, 'id'>) => string;
  updatePrimitive: (id: string, patch: Partial<Primitive>) => void;
  deletePrimitive: (id: string) => void;
  addDraftGroupMember: (memberKey: string) => void;
  removeDraftGroupMember: (memberKey: string) => void;
  reorderDraftGroupMember: (fromIndex: number, toIndex: number) => void;
  startGroupMemberPick: (primitiveId: string) => void;
  addGroupMember: (primitiveId: string, memberKey: string) => void;
  removeGroupMember: (primitiveId: string, memberKey: string) => void;
  reorderGroupMember: (primitiveId: string, fromIndex: number, toIndex: number) => void;
  clearDraftGroup: () => void;
  createGroupPrimitive: (
    name?: string,
    notes?: NoteCard[],
    tags?: string[],
    showMemberNumbers?: boolean,
    showOnLoad?: boolean
  ) => string | null;
  startNeighborPick: (primitiveId: string, pageIndex: number) => void;
  addNeighborMember: (memberKey: string) => void;
  removeNeighborMember: (primitiveId: string, memberKey: string) => void;
  cancelNeighborPick: () => void;
  clearPendingNameFocus: () => void;
}

const ZOOM_LOCK_STORAGE_KEY = 'diagram-note-zoom-lock';

function loadZoomLock() {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(ZOOM_LOCK_STORAGE_KEY) === 'true';
}

function persistZoomLock(value: boolean) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ZOOM_LOCK_STORAGE_KEY, String(value));
}

export const useEditorStore = create<EditorState>((set) => ({
  selectedPrimitiveId: null,
  hoveredPrimitiveId: null,
  workspace: EMPTY_WORKSPACE,
  draftGroupKeys: [],
  selectedOccurrenceIndex: 0,
  editorMode: 'none',
  draftOverlayColor: '#fb7185',
  draftPolygonPoints: [],
  draftRectangleStart: null,
  leftSidebarCollapsed: false,
  rightPaneOpen: true,
  zoomTarget: null,
  zoomLocked: loadZoomLock(),
  spacePanActive: false,
  pendingNameFocusId: null,
  overlayNeighborTargetId: null,
  overlayNeighborTargetPageIndex: null,
  groupCollectTargetId: null,

  setWorkspace: (workspace) =>
    set((s) => ({
      workspace,
      selectedPrimitiveId: null,
      hoveredPrimitiveId: null,
      draftGroupKeys: [],
      selectedOccurrenceIndex: 0,
      editorMode: s.editorMode === 'overlayNeighborPick' ? s.editorMode : 'none',
      draftPolygonPoints: [],
      draftRectangleStart: null,
      pendingNameFocusId: null,
      overlayNeighborTargetId:
        s.editorMode === 'overlayNeighborPick' ? s.overlayNeighborTargetId : null,
      overlayNeighborTargetPageIndex:
        s.editorMode === 'overlayNeighborPick' ? s.overlayNeighborTargetPageIndex : null,
      groupCollectTargetId: null,
    })),

  setSelectedPrimitiveId: (id) =>
    set({
      selectedPrimitiveId: id,
      selectedOccurrenceIndex: 0,
      rightPaneOpen: id !== null ? true : useEditorStore.getState().rightPaneOpen,
    }),

  setHoveredPrimitiveId: (id) => set({ hoveredPrimitiveId: id }),

  setSelectedOccurrenceIndex: (index) =>
    set({ selectedOccurrenceIndex: Math.max(0, index) }),

  cycleSelection: (direction) => {
    const state = useEditorStore.getState();
    const selected = state.workspace.primitives.find(
      (p) => p.id === state.selectedPrimitiveId
    );
    if (selected?.kind !== 'group') return false;
    const members = getGroupMemberKeys(selected);
    if (members.length <= 1) return false;
    const next =
      (state.selectedOccurrenceIndex + direction + members.length) % members.length;
    const member = parseMemberKey(members[next]);
    if (!member) return false;
    const memberPrim = state.workspace.primitives.find((p) => p.id === member.id);
    if (!memberPrim) return false;
    const primitivesById = new Map(state.workspace.primitives.map((p) => [p.id, p]));
    const bbox = getPrimitiveBounds(memberPrim, primitivesById);
    if (!bbox) return false;
    set({
      selectedOccurrenceIndex: next,
      zoomTarget: { bbox, immediate: false, lockZoom: true },
    });
    return true;
  },

  toggleLeftSidebar: () =>
    set((s) => ({ leftSidebarCollapsed: !s.leftSidebarCollapsed })),
  setLeftSidebarCollapsed: (collapsed) => set({ leftSidebarCollapsed: collapsed }),
  toggleRightPane: () => set((s) => ({ rightPaneOpen: !s.rightPaneOpen })),
  setZoomTarget: (target) => set({ zoomTarget: target }),
  toggleZoomLock: () =>
    set((s) => {
      const next = !s.zoomLocked;
      persistZoomLock(next);
      return { zoomLocked: next };
    }),
  setSpacePanActive: (active) => set({ spacePanActive: active }),

  setEditorMode: (mode) =>
    set((s) => ({
      editorMode: mode,
      draftPolygonPoints: mode === 'polygon' ? [] : [],
      draftRectangleStart: null,
      overlayNeighborTargetId:
        mode === 'overlayNeighborPick' ? s.overlayNeighborTargetId : null,
      overlayNeighborTargetPageIndex:
        mode === 'overlayNeighborPick' ? s.overlayNeighborTargetPageIndex : null,
      groupCollectTargetId: mode === 'groupCollect' ? s.groupCollectTargetId : null,
    })),

  setDraftOverlayColor: (color) => set({ draftOverlayColor: color }),
  addDraftPolygonPoint: (point) =>
    set((s) => ({ draftPolygonPoints: [...s.draftPolygonPoints, point] })),
  clearDraftPolygon: () => set({ draftPolygonPoints: [] }),
  setDraftRectangleStart: (point) => set({ draftRectangleStart: point }),

  addPrimitive: (primitive) => {
    const id = makePrimitiveId();
    set((s) => ({
      workspace: {
        ...s.workspace,
        primitives: [...s.workspace.primitives, { ...primitive, id }],
      },
      selectedPrimitiveId: id,
      selectedOccurrenceIndex: 0,
      rightPaneOpen: true,
      pendingNameFocusId: id,
    }));
    return id;
  },

  updatePrimitive: (id, patch) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        primitives: s.workspace.primitives.map((p) =>
          p.id === id ? { ...p, ...patch } : p
        ),
      },
    })),

  deletePrimitive: (id) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        primitives: s.workspace.primitives
          .filter((p) => p.id !== id)
          .map((p) => ({
            ...p,
            groupMemberKeys: (p.groupMemberKeys ?? []).filter(
              (key) => key !== makeMemberKey(id)
            ),
            relatedMemberKeys: (p.relatedMemberKeys ?? []).filter(
              (key) => key !== makeMemberKey(id)
            ),
          })),
      },
      selectedPrimitiveId:
        s.selectedPrimitiveId === id ? null : s.selectedPrimitiveId,
    })),

  addDraftGroupMember: (memberKey) =>
    set((s) => ({
      draftGroupKeys: s.draftGroupKeys.includes(memberKey)
        ? s.draftGroupKeys
        : [...s.draftGroupKeys, memberKey],
    })),

  removeDraftGroupMember: (memberKey) =>
    set((s) => ({
      draftGroupKeys: s.draftGroupKeys.filter((k) => k !== memberKey),
    })),

  reorderDraftGroupMember: (fromIndex, toIndex) =>
    set((s) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= s.draftGroupKeys.length ||
        toIndex >= s.draftGroupKeys.length ||
        fromIndex === toIndex
      ) {
        return {};
      }
      const next = [...s.draftGroupKeys];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return { draftGroupKeys: next };
    }),

  startGroupMemberPick: (primitiveId) =>
    set({
      selectedPrimitiveId: primitiveId,
      editorMode: 'groupCollect',
      groupCollectTargetId: primitiveId,
      rightPaneOpen: true,
    }),

  addGroupMember: (primitiveId, memberKey) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        primitives: s.workspace.primitives.map((p) =>
          p.id === primitiveId
            ? {
                ...p,
                groupMemberKeys: Array.from(
                  new Set([...(p.groupMemberKeys ?? []), memberKey])
                ).filter((key) => key !== makeMemberKey(primitiveId)),
              }
            : p
        ),
      },
      selectedPrimitiveId: primitiveId,
      rightPaneOpen: true,
    })),

  removeGroupMember: (primitiveId, memberKey) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        primitives: s.workspace.primitives.map((p) =>
          p.id === primitiveId
            ? {
                ...p,
                groupMemberKeys: (p.groupMemberKeys ?? []).filter((key) => key !== memberKey),
              }
            : p
        ),
      },
    })),

  reorderGroupMember: (primitiveId, fromIndex, toIndex) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        primitives: s.workspace.primitives.map((p) => {
          if (p.id !== primitiveId) return p;
          const current = p.groupMemberKeys ?? [];
          if (
            fromIndex < 0 ||
            toIndex < 0 ||
            fromIndex >= current.length ||
            toIndex >= current.length ||
            fromIndex === toIndex
          ) {
            return p;
          }
          const next = [...current];
          const [moved] = next.splice(fromIndex, 1);
          next.splice(toIndex, 0, moved);
          return { ...p, groupMemberKeys: next };
        }),
      },
    })),

  clearDraftGroup: () => set({ draftGroupKeys: [] }),

  createGroupPrimitive: (
    name,
    notes = [],
    tags = [],
    showMemberNumbers = false,
    showOnLoad = false
  ) => {
    const state = useEditorStore.getState();
    if (state.draftGroupKeys.length === 0) return null;
    const id = makePrimitiveId();
    const primitive: Primitive = {
      id,
      kind: 'group',
      name: name?.trim() || `Group ${state.workspace.primitives.length + 1}`,
      color: state.draftOverlayColor,
      tags,
      notes,
      groupMemberKeys: state.draftGroupKeys,
      showMemberNumbers,
      showOnLoad,
    };
    set((s) => ({
      workspace: {
        ...s.workspace,
        primitives: [...s.workspace.primitives, primitive],
      },
      draftGroupKeys: [],
      selectedPrimitiveId: id,
      selectedOccurrenceIndex: 0,
      editorMode: 'none',
      groupCollectTargetId: null,
      rightPaneOpen: true,
    }));
    return id;
  },

  startNeighborPick: (primitiveId, pageIndex) =>
    set({
      selectedPrimitiveId: primitiveId,
      editorMode: 'overlayNeighborPick',
      overlayNeighborTargetId: primitiveId,
      overlayNeighborTargetPageIndex: pageIndex,
      groupCollectTargetId: null,
      rightPaneOpen: true,
    }),

  addNeighborMember: (memberKey) =>
    set((s) => {
      const targetId = s.overlayNeighborTargetId;
      if (!targetId) return {};
      const targetKey = makeMemberKey(targetId);
      const member = parseMemberKey(memberKey);
      if (!member || memberKey === targetKey) {
        return {
          editorMode: 'none',
          overlayNeighborTargetId: null,
          overlayNeighborTargetPageIndex: null,
          selectedPrimitiveId: targetId,
          rightPaneOpen: true,
        };
      }
      return {
        workspace: {
          ...s.workspace,
          primitives: s.workspace.primitives.map((p) => {
            if (p.id === targetId) {
              const next = Array.from(
                new Set([...(p.relatedMemberKeys ?? []), memberKey])
              ).filter((k) => k !== targetKey);
              return { ...p, relatedMemberKeys: next };
            }
            if (p.id === member.id) {
              const next = Array.from(
                new Set([...(p.relatedMemberKeys ?? []), targetKey])
              ).filter((k) => k !== memberKey);
              return { ...p, relatedMemberKeys: next };
            }
            return p;
          }),
        },
        editorMode: 'none',
        overlayNeighborTargetId: null,
        overlayNeighborTargetPageIndex: null,
        groupCollectTargetId: null,
        selectedPrimitiveId: targetId,
        rightPaneOpen: true,
      };
    }),

  removeNeighborMember: (primitiveId, memberKey) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        primitives: s.workspace.primitives.map((p) =>
          p.id === primitiveId
            ? {
                ...p,
                relatedMemberKeys: (p.relatedMemberKeys ?? []).filter(
                  (k) => k !== memberKey
                ),
              }
            : parseMemberKey(memberKey)?.id === p.id
              ? {
                  ...p,
                  relatedMemberKeys: (p.relatedMemberKeys ?? []).filter(
                    (k) => k !== makeMemberKey(primitiveId)
                  ),
                }
              : p
        ),
      },
    })),

  cancelNeighborPick: () =>
    set({
      editorMode: 'none',
      overlayNeighborTargetId: null,
      overlayNeighborTargetPageIndex: null,
      groupCollectTargetId: null,
    }),

  clearPendingNameFocus: () => set({ pendingNameFocusId: null }),
}));
