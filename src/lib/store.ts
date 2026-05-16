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

export type ZoomTarget = {
  bbox: BBox;
  immediate?: boolean;
  lockZoom?: boolean;
  padding?: number;
};

export type OverlayFilterKey = 'studyBox' | 'group' | 'region' | 'priorityNote';

export type OverlayFilterState = Record<OverlayFilterKey, boolean>;

export const DEFAULT_OVERLAY_FILTERS: OverlayFilterState = {
  studyBox: false,
  group: false,
  region: false,
  priorityNote: false,
};

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
  visibleOverlayFilters: OverlayFilterState;
  leftSidebarCollapsed: boolean;
  rightPaneOpen: boolean;
  zoomTarget: ZoomTarget | null;
  zoomLocked: boolean;
  panLocked: boolean;
  spacePanActive: boolean;
  pendingNameFocusId: string | null;
  overlayNeighborTargetId: string | null;
  overlayNeighborTargetPageIndex: number | null;
  groupCollectTargetId: string | null;

  setWorkspace: (workspace: MapWorkspace, resetUi?: boolean) => void;
  setSelectedPrimitiveId: (id: string | null) => void;
  setHoveredPrimitiveId: (id: string | null) => void;
  setSelectedOccurrenceIndex: (index: number) => void;
  cycleSelection: (direction: -1 | 1) => boolean;
  toggleLeftSidebar: () => void;
  setLeftSidebarCollapsed: (collapsed: boolean) => void;
  toggleRightPane: () => void;
  setZoomTarget: (target: ZoomTarget | null) => void;
  toggleZoomLock: () => void;
  togglePanLock: () => void;
  setSpacePanActive: (active: boolean) => void;
  setEditorMode: (mode: EditorMode) => void;
  setDraftOverlayColor: (color: string) => void;
  addDraftPolygonPoint: (point: Point) => void;
  clearDraftPolygon: () => void;
  setDraftRectangleStart: (point: Point | null) => void;
  addPrimitive: (primitive: Omit<Primitive, 'id'>) => string;
  updatePrimitive: (id: string, patch: Partial<Primitive>) => void;
  toggleShowAllOverlayFilters: () => void;
  toggleOverlayFilter: (key: OverlayFilterKey) => void;
  toggleAllPriorityNoteCollapsed: () => void;
  setAllPriorityNoteCollapsed: (collapsed: boolean) => void;
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
const PAN_LOCK_STORAGE_KEY = 'diagram-note-pan-lock';

function loadZoomLock() {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(ZOOM_LOCK_STORAGE_KEY) === 'true';
}

function persistZoomLock(value: boolean) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ZOOM_LOCK_STORAGE_KEY, String(value));
}

function loadPanLock() {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(PAN_LOCK_STORAGE_KEY) === 'true';
}

function persistPanLock(value: boolean) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PAN_LOCK_STORAGE_KEY, String(value));
}

function stampPrimitiveCreated<T extends Omit<Primitive, 'id'>>(primitive: T): T {
  const now = Date.now();
  return {
    ...primitive,
    createdAt: primitive.createdAt ?? now,
    updatedAt: primitive.updatedAt ?? now,
  };
}

function stampPrimitiveUpdated<T extends Primitive>(
  primitive: T,
  fallbackCreatedAt: number
): T {
  const now = Date.now();
  return {
    ...primitive,
    createdAt: primitive.createdAt ?? fallbackCreatedAt,
    updatedAt: now,
  };
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
  visibleOverlayFilters: DEFAULT_OVERLAY_FILTERS,
  leftSidebarCollapsed: true,
  rightPaneOpen: true,
  zoomTarget: null,
  zoomLocked: loadZoomLock(),
  panLocked: loadPanLock(),
  spacePanActive: false,
  pendingNameFocusId: null,
  overlayNeighborTargetId: null,
  overlayNeighborTargetPageIndex: null,
  groupCollectTargetId: null,

  setWorkspace: (workspace, resetUi = true) =>
    set((s) => ({
      workspace,
      selectedPrimitiveId: null,
      hoveredPrimitiveId: null,
      draftGroupKeys: [],
      selectedOccurrenceIndex: 0,
      editorMode: s.editorMode === 'overlayNeighborPick' ? s.editorMode : 'none',
      draftPolygonPoints: [],
      draftRectangleStart: null,
      ...(resetUi ? { visibleOverlayFilters: DEFAULT_OVERLAY_FILTERS } : {}),
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
    if (!selected) return false;
    const primitivesById = new Map(state.workspace.primitives.map((p) => [p.id, p]));

    if (selected.kind === 'group') {
      const members = getGroupMemberKeys(selected);
      if (members.length <= 1) return false;
      const next =
        (state.selectedOccurrenceIndex + direction + members.length) % members.length;
      const member = parseMemberKey(members[next]);
      if (!member) return false;
      const memberPrim = state.workspace.primitives.find((p) => p.id === member.id);
      if (!memberPrim) return false;
      const bbox = getPrimitiveBounds(memberPrim, primitivesById);
      if (!bbox) return false;
      set({
        selectedOccurrenceIndex: next,
        zoomTarget: { bbox, immediate: false, lockZoom: true, padding: 16 },
      });
      return true;
    }

    const normalizedName = selected.name.trim().toLowerCase();
    if (!normalizedName) return false;
    const sameName = state.workspace.primitives.filter(
      (primitive) => primitive.name.trim().toLowerCase() === normalizedName
    );
    if (sameName.length <= 1) return false;
    const currentIndex = sameName.findIndex((primitive) => primitive.id === selected.id);
    if (currentIndex === -1) return false;
    const next = (currentIndex + direction + sameName.length) % sameName.length;
    const nextPrimitive = sameName[next];
    const bbox = getPrimitiveBounds(nextPrimitive, primitivesById);
    if (!bbox) return false;
    set({
      selectedPrimitiveId: nextPrimitive.id,
      selectedOccurrenceIndex: next,
      zoomTarget: { bbox, immediate: false, lockZoom: true, padding: 16 },
      rightPaneOpen: true,
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
  togglePanLock: () =>
    set((s) => {
      const next = !s.panLocked;
      persistPanLock(next);
      return { panLocked: next };
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
        primitives: [...s.workspace.primitives, { ...stampPrimitiveCreated(primitive), id }],
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
        primitives: s.workspace.primitives.map((p, index) =>
          p.id === id ? stampPrimitiveUpdated({ ...p, ...patch }, index) : p
        ),
      },
    })),

  toggleShowAllOverlayFilters: () =>
    set((s) => {
      const allVisible = Object.values(s.visibleOverlayFilters).every(Boolean);
      const nextFilters = {
        studyBox: !allVisible,
        group: !allVisible,
        region: !allVisible,
        priorityNote: !allVisible,
      };
      const anyVisible = Object.values(nextFilters).some(Boolean);
      return {
        visibleOverlayFilters: nextFilters,
        selectedPrimitiveId: anyVisible ? s.selectedPrimitiveId : null,
        hoveredPrimitiveId: anyVisible ? s.hoveredPrimitiveId : null,
        selectedOccurrenceIndex: anyVisible ? s.selectedOccurrenceIndex : 0,
      };
    }),

  toggleOverlayFilter: (key) =>
    set((s) => {
      const nextFilters = {
        ...s.visibleOverlayFilters,
        [key]: !s.visibleOverlayFilters[key],
      };
      const anyVisible = Object.values(nextFilters).some(Boolean);
      return {
        visibleOverlayFilters: nextFilters,
        selectedPrimitiveId: anyVisible ? s.selectedPrimitiveId : null,
        hoveredPrimitiveId: anyVisible ? s.hoveredPrimitiveId : null,
        selectedOccurrenceIndex: anyVisible ? s.selectedOccurrenceIndex : 0,
      };
    }),

  toggleAllPriorityNoteCollapsed: () =>
    set((s) => {
      const priorityPrimitives = s.workspace.primitives.filter(
        (primitive) =>
          primitive.showPriorityNote === true &&
          (primitive.notes ?? []).some((note) => note.isPriority && note.content.trim())
      );
      if (priorityPrimitives.length === 0) return {};
      const shouldCollapse = priorityPrimitives.some(
        (primitive) => primitive.priorityNoteCollapsed !== true
      );
      return {
        workspace: {
          ...s.workspace,
          primitives: s.workspace.primitives.map((primitive) =>
            priorityPrimitives.some((entry) => entry.id === primitive.id)
              ? { ...primitive, priorityNoteCollapsed: shouldCollapse }
              : primitive
          ),
        },
      };
    }),

  setAllPriorityNoteCollapsed: (collapsed) =>
    set((s) => {
      const priorityIds = new Set(
        s.workspace.primitives
          .filter(
            (primitive) =>
              primitive.showPriorityNote === true &&
              (primitive.notes ?? []).some((note) => note.isPriority && note.content.trim())
          )
          .map((primitive) => primitive.id)
      );
      if (priorityIds.size === 0) return {};
      return {
        workspace: {
          ...s.workspace,
          primitives: s.workspace.primitives.map((primitive) =>
            priorityIds.has(primitive.id)
              ? { ...primitive, priorityNoteCollapsed: collapsed }
              : primitive
          ),
        },
      };
    }),

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
    set((s) => {
      const groupKey = makeMemberKey(primitiveId);
      const member = parseMemberKey(memberKey);
      return {
        workspace: {
          ...s.workspace,
          primitives: s.workspace.primitives.map((p) => {
            if (p.id === primitiveId) {
              return {
                ...p,
                groupMemberKeys: Array.from(
                  new Set([...(p.groupMemberKeys ?? []), memberKey])
                ).filter((key) => key !== groupKey),
              };
            }
            if (member && p.id === member.id) {
              return {
                ...p,
                relatedMemberKeys: Array.from(
                  new Set([...(p.relatedMemberKeys ?? []), groupKey])
                ).filter((key) => key !== memberKey),
              };
            }
            return p;
          }),
        },
        selectedPrimitiveId: primitiveId,
        rightPaneOpen: true,
      };
    }),

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
            : parseMemberKey(memberKey)?.id === p.id
              ? {
                  ...p,
                  relatedMemberKeys: (p.relatedMemberKeys ?? []).filter(
                    (key) => key !== makeMemberKey(primitiveId)
                  ),
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
    const groupKey = makeMemberKey(id);
    const memberIds = new Set(
      state.draftGroupKeys
        .map((key) => parseMemberKey(key)?.id)
        .filter((value): value is string => Boolean(value))
    );
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
    const stampedPrimitive = stampPrimitiveCreated(primitive);
    set((s) => ({
      workspace: {
        ...s.workspace,
        primitives: [
          ...s.workspace.primitives.map((p, index) => {
            if (!memberIds.has(p.id)) {
              return p;
            }
            return stampPrimitiveUpdated({
              ...p,
              relatedMemberKeys: Array.from(
                new Set([...(p.relatedMemberKeys ?? []), groupKey])
              ).filter((key) => key !== makeMemberKey(p.id)),
            }, index);
          }),
          stampedPrimitive,
        ],
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
          primitives: s.workspace.primitives.map((p, index) => {
            if (p.id === targetId) {
              const next = Array.from(
                new Set([...(p.relatedMemberKeys ?? []), memberKey])
              ).filter((k) => k !== targetKey);
              return stampPrimitiveUpdated({ ...p, relatedMemberKeys: next }, index);
            }
            if (p.id === member.id) {
              const next = Array.from(
                new Set([...(p.relatedMemberKeys ?? []), targetKey])
              ).filter((k) => k !== memberKey);
              return stampPrimitiveUpdated({ ...p, relatedMemberKeys: next }, index);
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
        primitives: s.workspace.primitives.map((p, index) =>
          p.id === primitiveId
            ? stampPrimitiveUpdated({
                ...p,
                relatedMemberKeys: (p.relatedMemberKeys ?? []).filter(
                  (k) => k !== memberKey
                ),
              }, index)
            : parseMemberKey(memberKey)?.id === p.id
              ? stampPrimitiveUpdated({
                  ...p,
                  relatedMemberKeys: (p.relatedMemberKeys ?? []).filter(
                    (k) => k !== makeMemberKey(primitiveId)
                  ),
                }, index)
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
