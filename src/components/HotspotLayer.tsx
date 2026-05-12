import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';
import {
  bboxToViewerElementRect,
  fitBBox,
  normalizedPointToViewerElementPoint,
  viewerElementPointToNormalizedPoint,
  type SourceDims,
} from '../lib/coords';
import {
  DEFAULT_OVERLAY_FILTERS,
  useEditorStore,
  type OverlayFilterState,
} from '../lib/store';
import {
  bboxFromPoints,
  getGroupMemberKeys,
  getPrimitiveBounds,
  makeMemberKey,
  parseMemberKey,
} from '../lib/workspace';
import type { MapWorkspace, Point, Primitive } from '../types';
import { useMapStore } from '../lib/mapStore';

interface HotspotLayerProps {
  viewer: OpenSeadragon.Viewer;
  dims: SourceDims;
  mapDragActive: boolean;
  onMapDragActiveChange: (active: boolean) => void;
  compareOnly?: boolean;
  workspaceOverride?: MapWorkspace;
  compareShowAllOverlays?: boolean;
  compareVisibleOverlayFilters?: OverlayFilterState;
  onComparePrimitivePatch?: (id: string, patch: Partial<Primitive>) => void;
  compareZoomLocked?: boolean;
  comparePanLocked?: boolean;
  selectedPrimitiveIdOverride?: string | null;
  onSelectPrimitiveOverride?: (primitiveId: string) => void;
  compareBacklinkPickActive?: boolean;
  onPickCompareBacklinkTarget?: (primitiveId: string) => void;
  compareLinkFlash?: { primitiveId: string; nonce: number } | null;
  compareLinkConfirmIds?: string[];
}

const FOCUS_PADDING = 16;
const PRIORITY_BUBBLE_MIN_WIDTH = 180;
const PRIORITY_BUBBLE_MAX_WIDTH = 340;
const PRIORITY_BUBBLE_PADDING_X = 14;
const PRIORITY_BUBBLE_PADDING_TOP = 22;
const PRIORITY_BUBBLE_PADDING_BOTTOM = 14;
const PRIORITY_BUBBLE_LINE_HEIGHT = 16;
const PRIORITY_BUBBLE_CHAR_LIMIT = 42;
const PRIORITY_BUBBLE_COLLAPSED_WIDTH = 30;
const PRIORITY_BUBBLE_COLLAPSED_HEIGHT = 20;

let _textMeasureCtx: CanvasRenderingContext2D | null = null;
function measureTextWidth(text: string, font: string): number {
  if (!_textMeasureCtx) {
    _textMeasureCtx = document.createElement('canvas').getContext('2d');
  }
  if (!_textMeasureCtx) return text.length * 6;
  _textMeasureCtx.font = font;
  return _textMeasureCtx.measureText(text).width;
}

function isStudyBoxPrimitive(primitive: Primitive) {
  return primitive.kind === 'rectangle';
}

function isMapSelectablePrimitive(primitive: Primitive) {
  return primitive.kind !== 'group';
}

function getPriorityNote(primitive: Primitive | null) {
  return primitive?.notes?.find((note) => note.isPriority && note.content.trim()) ?? null;
}

function getPriorityNoteIndex(primitive: Primitive | null) {
  return primitive?.notes?.findIndex((note) => note.isPriority && note.content.trim()) ?? -1;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function wrapPriorityText(content: string, limit = PRIORITY_BUBBLE_CHAR_LIMIT) {
  const paragraphs = content
    .trim()
    .split(/\r?\n/)
    .flatMap((paragraph) => {
      const words = paragraph.trim().split(/\s+/).filter(Boolean);
      if (words.length === 0) return [''];
      const lines: string[] = [];
      let current = '';
      for (const word of words) {
        if (current.length === 0) {
          current = word;
          continue;
        }
        if (`${current} ${word}`.length <= limit) {
          current = `${current} ${word}`;
          continue;
        }
        lines.push(current);
        current = word;
      }
      if (current) lines.push(current);
      return lines;
    });
  return paragraphs.length > 0 ? paragraphs : [''];
}

function layoutPriorityBubble(content: string) {
  const rawLines = content.trim().split(/\r?\n/);
  const longestRawLine = rawLines.reduce((max, line) => Math.max(max, line.trim().length), 0);
  const targetChars = clamp(Math.max(18, Math.min(longestRawLine, PRIORITY_BUBBLE_CHAR_LIMIT)), 18, PRIORITY_BUBBLE_CHAR_LIMIT);
  const lines = wrapPriorityText(content, targetChars);
  const longestWrappedLine = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const width = clamp(
    longestWrappedLine * 6.8 + PRIORITY_BUBBLE_PADDING_X * 2,
    PRIORITY_BUBBLE_MIN_WIDTH,
    PRIORITY_BUBBLE_MAX_WIDTH
  );
  const height =
    PRIORITY_BUBBLE_PADDING_TOP +
    PRIORITY_BUBBLE_PADDING_BOTTOM +
    lines.length * PRIORITY_BUBBLE_LINE_HEIGHT;
  return { lines, width, height };
}

function getPriorityBubbleBasePoint(bounds: Primitive['bbox']) {
  if (!bounds) return null;
  return {
    x: clamp(bounds.x + bounds.w / 2, 0.02, 0.98),
    y: clamp(bounds.y, 0.02, 0.98),
  };
}

export default function HotspotLayer({
  viewer,
  dims,
  mapDragActive,
  onMapDragActiveChange,
  compareOnly = false,
  workspaceOverride,
  compareShowAllOverlays = false,
  compareVisibleOverlayFilters = DEFAULT_OVERLAY_FILTERS,
  onComparePrimitivePatch,
  compareZoomLocked = false,
  comparePanLocked = false,
  selectedPrimitiveIdOverride,
  onSelectPrimitiveOverride,
  compareBacklinkPickActive = false,
  onPickCompareBacklinkTarget,
  compareLinkFlash,
  compareLinkConfirmIds = [],
}: HotspotLayerProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewportSize, setViewportSize] = useState({ w: 1, h: 1 });
  const [viewTick, setViewTick] = useState(0);
  const [viewportAnimating, setViewportAnimating] = useState(false);
  const [draftPointer, setDraftPointer] = useState<Point | null>(null);
  const [editingPriorityPrimitiveId, setEditingPriorityPrimitiveId] = useState<string | null>(null);
  const [editingPriorityDraft, setEditingPriorityDraft] = useState('');
  const [movePriorityPrimitiveId, setMovePriorityPrimitiveId] = useState<string | null>(null);
  const [linkFlash, setLinkFlash] = useState<{ primitiveId: string; nonce: number } | null>(null);
  const [linkConfirmIds, setLinkConfirmIds] = useState<string[]>([]);
  const animationIdleTimerRef = useRef<number | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    activate: () => void;
  } | null>(null);
  const priorityBubbleDragRef = useRef<{
    pointerId: number;
    primitiveId: string;
    anchorOffsetX: number;
    anchorOffsetY: number;
  } | null>(null);
  const [priorityBubbleDraftAnchors, setPriorityBubbleDraftAnchors] = useState<
    Record<string, Point>
  >({});

  const storeSelectedPrimitiveId = useEditorStore((s) => s.selectedPrimitiveId);
  const hoveredPrimitiveId = useEditorStore((s) => s.hoveredPrimitiveId);
  const selectedOccurrenceIndex = useEditorStore((s) => s.selectedOccurrenceIndex);
  const storeWorkspace = useEditorStore((s) => s.workspace);
  const workspace = workspaceOverride ?? storeWorkspace;
  const editorMode = useEditorStore((s) => s.editorMode);
  const visibleOverlayFilters = useEditorStore((s) => s.visibleOverlayFilters);
  const draftOverlayColor = useEditorStore((s) => s.draftOverlayColor);
  const draftPolygonPoints = useEditorStore((s) => s.draftPolygonPoints);
  const draftRectangleStart = useEditorStore((s) => s.draftRectangleStart);
  const setSelectedPrimitiveId = useEditorStore((s) => s.setSelectedPrimitiveId);
  const setHoveredPrimitiveId = useEditorStore((s) => s.setHoveredPrimitiveId);
  const addDraftPolygonPoint = useEditorStore((s) => s.addDraftPolygonPoint);
  const clearDraftPolygon = useEditorStore((s) => s.clearDraftPolygon);
  const setDraftRectangleStart = useEditorStore((s) => s.setDraftRectangleStart);
  const addPrimitive = useEditorStore((s) => s.addPrimitive);
  const updatePrimitive = useEditorStore((s) => s.updatePrimitive);
  const setEditorMode = useEditorStore((s) => s.setEditorMode);
  const zoomLocked = useEditorStore((s) => s.zoomLocked);
  const panLocked = useEditorStore((s) => s.panLocked);
  const effectiveZoomLocked = compareOnly ? compareZoomLocked : zoomLocked;
  const effectivePanLocked = compareOnly ? comparePanLocked : panLocked;
  const zoomTarget = useEditorStore((s) => s.zoomTarget);
  const spacePanActive = useEditorStore((s) => s.spacePanActive);
  const addDraftGroupMember = useEditorStore((s) => s.addDraftGroupMember);
  const addGroupMember = useEditorStore((s) => s.addGroupMember);
  const addNeighborMember = useEditorStore((s) => s.addNeighborMember);
  const overlayNeighborTargetId = useEditorStore((s) => s.overlayNeighborTargetId);
  const overlayNeighborTargetPageIndex = useEditorStore(
    (s) => s.overlayNeighborTargetPageIndex
  );
  const groupCollectTargetId = useEditorStore((s) => s.groupCollectTargetId);
  const setActivePage = useMapStore((s) => s.setActivePage);
  const addPrimitiveBacklink = useMapStore((s) => s.addPrimitiveBacklink);
  const activeMapId = useMapStore((s) => s.activeMapId);
  const activePageIndex = useMapStore(
    (s) => s.maps.find((m) => m.id === s.activeMapId)?.pageIndex ?? 0
  );

  const primitivesById = useMemo(
    () => new Map(workspace.primitives.map((p) => [p.id, p])),
    [workspace.primitives]
  );
  const selectedPrimitiveId = compareOnly ? selectedPrimitiveIdOverride ?? null : storeSelectedPrimitiveId;
  const setSelectedPrimitive = compareOnly
    ? (onSelectPrimitiveOverride ?? (() => {}))
    : setSelectedPrimitiveId;
  const selectedPrimitive = selectedPrimitiveId
    ? primitivesById.get(selectedPrimitiveId) ?? null
    : null;
  const allSingleOverlayFiltersVisible = Object.values(visibleOverlayFilters).every(Boolean);
  const allCompareOverlayFiltersVisible = Object.values(
    compareVisibleOverlayFilters
  ).every(Boolean);

  const groupedStudyBoxIds = useMemo(() => {
    const ids = new Set<string>();
    for (const primitive of workspace.primitives) {
      if (primitive.kind !== 'group') continue;
      for (const memberKey of getGroupMemberKeys(primitive)) {
        const member = parseMemberKey(memberKey);
        if (!member) continue;
        const memberPrimitive = primitivesById.get(member.id);
        if (memberPrimitive?.kind === 'rectangle') {
          ids.add(member.id);
        }
      }
    }
    return ids;
  }, [workspace.primitives, primitivesById]);

  const primitiveMatchesFilter = useCallback(
    (primitive: Primitive, filters: OverlayFilterState) => {
      if (primitive.kind === 'rectangle') {
        const isGroupedMember = groupedStudyBoxIds.has(primitive.id);
        const allVisible = Object.values(filters).every(Boolean);
        if (allVisible) return true;
        if (filters.studyBox) {
          return isGroupedMember ? filters.studyBox !== filters.group : true;
        }
        return filters.group ? isGroupedMember : false;
      }
      if (primitive.kind === 'polygon') return filters.region;
      if (primitive.kind === 'group') return false;
      return false;
    },
    [groupedStudyBoxIds]
  );

  const primitiveShapes = useMemo(() => {
    const entries = workspace.primitives
      .map((primitive) => {
        const bounds = getPrimitiveBounds(primitive, primitivesById);
        if (!bounds) return null;
        return { primitive, bounds };
      })
      .filter(
        (entry): entry is { primitive: Primitive; bounds: import('../types').BBox } =>
          entry !== null
      );
    // Groups rendered first so member primitives and user-drawn regions stay on top.
    entries.sort((a, b) => {
      if (a.primitive.kind === 'group' && b.primitive.kind !== 'group') return -1;
      if (a.primitive.kind !== 'group' && b.primitive.kind === 'group') return 1;
      return 0;
    });
    return entries;
  }, [workspace.primitives, primitivesById]);

  // Selected group children — to highlight + number on the map
  const selectedGroupTargets = useMemo(() => {
    if (selectedPrimitive?.kind !== 'group') return [];
    return getGroupMemberKeys(selectedPrimitive)
      .map((key, index) => {
        const member = parseMemberKey(key);
        if (!member) return null;
        const memberPrim = primitivesById.get(member.id);
        if (!memberPrim) return null;
        const bbox = getPrimitiveBounds(memberPrim, primitivesById);
        if (!bbox) return null;
        return { key, id: memberPrim.id, primitive: memberPrim, bbox, order: index + 1 };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }, [selectedPrimitive, primitivesById]);

  const selectedNameTargets = useMemo(() => {
    if (!selectedPrimitive || selectedPrimitive.kind === 'group') return [];
    const normalizedName = selectedPrimitive.name.trim().toLowerCase();
    if (!normalizedName) return [];
    return workspace.primitives
      .filter((primitive) => primitive.name.trim().toLowerCase() === normalizedName)
      .map((primitive) => {
        const bbox = getPrimitiveBounds(primitive, primitivesById);
        if (!bbox) return null;
        return { id: primitive.id, primitive, bbox };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }, [selectedPrimitive, primitivesById, workspace.primitives]);

  const priorityBubbles = useMemo(() => {
    return workspace.primitives
      .map((primitive) => {
        const priorityNote = getPriorityNote(primitive);
        if (!priorityNote || primitive.showPriorityNote !== true) return null;
        const isSelected = selectedPrimitiveId === primitive.id;
        const shouldShow =
          isSelected ||
          (compareOnly
            ? allCompareOverlayFiltersVisible || compareVisibleOverlayFilters.priorityNote
            : allSingleOverlayFiltersVisible || visibleOverlayFilters.priorityNote);
        if (!shouldShow) return null;
        const bounds = getPrimitiveBounds(primitive, primitivesById);
        if (!bounds) return null;
        const basePointNormalized = getPriorityBubbleBasePoint(bounds);
        if (!basePointNormalized) return null;
        const basePoint = normalizedPointToViewerElementPoint(
          viewer,
          basePointNormalized,
          dims
        );
        if (!basePoint) return null;
        const layout = layoutPriorityBubble(priorityNote.content);
        const fallbackAnchor = primitive.priorityNoteOffset
          ? (() => {
              const topCenterX = basePoint.x + primitive.priorityNoteOffset.x;
              const topY = basePoint.y + primitive.priorityNoteOffset.y - layout.height;
              return viewerElementPointToNormalizedPoint(viewer, topCenterX, topY, dims);
            })()
          : null;
        const collapsed = primitive.priorityNoteCollapsed === true;
        const expandedAnchor =
          priorityBubbleDraftAnchors[primitive.id] ??
          primitive.priorityNoteAnchor ??
          fallbackAnchor ??
          {
            x: clamp(bounds.x + bounds.w / 2, 0.02, 0.98),
            y: clamp(bounds.y - 0.06, 0.02, 0.98),
          };
        const width = collapsed ? PRIORITY_BUBBLE_COLLAPSED_WIDTH : layout.width;
        const height = collapsed ? PRIORITY_BUBBLE_COLLAPSED_HEIGHT : layout.height;
        let anchor = expandedAnchor;
        let x = 0;
        let y = 0;
        if (collapsed) {
          const rect = bboxToViewerElementRect(viewer, bounds, dims);
          if (!rect) return null;
          x = rect.x + rect.width - 2;
          y = rect.y - height - 6;
          anchor =
            viewerElementPointToNormalizedPoint(viewer, x + width / 2, y, dims) ??
            expandedAnchor;
        } else {
          const anchorPoint = normalizedPointToViewerElementPoint(viewer, anchor, dims);
          if (!anchorPoint) return null;
          x = anchorPoint.x - width / 2;
          y = anchorPoint.y;
        }
        const backlinkKeys = primitive.relatedMemberKeys ?? [];
        return {
          primitiveId: primitive.id,
          anchor,
          collapsed,
          x,
          y,
          width,
          height,
          lines: layout.lines,
          backlinkKeys,
        };
      })
      .filter((bubble): bubble is NonNullable<typeof bubble> => bubble !== null);
  }, [
    compareOnly,
    workspace.primitives,
    selectedPrimitiveId,
    visibleOverlayFilters.priorityNote,
    compareVisibleOverlayFilters.priorityNote,
    allSingleOverlayFiltersVisible,
    allCompareOverlayFiltersVisible,
    priorityBubbleDraftAnchors,
    primitivesById,
    viewer,
    dims,
    viewportSize.w,
    viewportSize.h,
    viewTick,
  ]);

  useEffect(() => {
    let frame: number | null = null;

    const update = () => {
      const size = viewer.viewport.getContainerSize();
      setViewportSize({ w: size.x, h: size.y });
      setViewTick((tick) => tick + 1);
      frame = null;
    };
    const schedule = () => {
      if (frame !== null) return;
       setViewportAnimating(true);
       if (animationIdleTimerRef.current !== null) {
         window.clearTimeout(animationIdleTimerRef.current);
       }
       animationIdleTimerRef.current = window.setTimeout(() => {
         setViewportAnimating(false);
         animationIdleTimerRef.current = null;
       }, 120);
      frame = window.requestAnimationFrame(update);
    };

    viewer.addHandler('animation', schedule);
    viewer.addHandler('update-viewport', schedule);
    viewer.addHandler('open', schedule);
    viewer.addHandler('resize', schedule);
    schedule();

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (animationIdleTimerRef.current !== null) {
        window.clearTimeout(animationIdleTimerRef.current);
        animationIdleTimerRef.current = null;
      }
      viewer.removeHandler('animation', schedule);
      viewer.removeHandler('update-viewport', schedule);
      viewer.removeHandler('open', schedule);
      viewer.removeHandler('resize', schedule);
    };
  }, [viewer]);

  useEffect(() => {
    setPriorityBubbleDraftAnchors({});
    priorityBubbleDragRef.current = null;
  }, [selectedPrimitiveId]);

  useEffect(() => {
    setEditingPriorityPrimitiveId(null);
    setEditingPriorityDraft('');
    setMovePriorityPrimitiveId(null);
  }, [workspace.primitives, compareOnly]);

  useEffect(() => {
    if (!linkFlash) return;
    const timer = window.setTimeout(() => setLinkFlash(null), 700);
    return () => window.clearTimeout(timer);
  }, [linkFlash]);

  useEffect(() => {
    if (compareOnly) return;
    if (linkConfirmIds.length === 0) return;
    if (!selectedPrimitiveId) {
      setLinkConfirmIds([]);
      return;
    }
    if (!linkConfirmIds.includes(selectedPrimitiveId)) {
      setLinkConfirmIds([]);
    }
  }, [compareOnly, linkConfirmIds, selectedPrimitiveId]);

  const simplifyOverlay = viewportAnimating && editorMode === 'none';

  // re-fit map to selected primitive
  const selectionGeomKey = selectedPrimitive
    ? JSON.stringify({
        kind: selectedPrimitive.kind,
        bbox: selectedPrimitive.bbox,
        points: selectedPrimitive.points,
        groupMemberKeys: selectedPrimitive.groupMemberKeys,
      })
    : null;

  useEffect(() => {
    if (compareOnly) return;
    if (zoomTarget) return;
    if (!selectedPrimitive) return;
    if (selectedPrimitive.kind === 'group' && selectedGroupTargets.length) {
      const target =
        selectedGroupTargets[
          Math.min(selectedOccurrenceIndex, selectedGroupTargets.length - 1)
        ];
      if (target?.bbox) {
        fitBBox(viewer, target.bbox, dims, {
          locked: effectiveZoomLocked,
          frozen: effectivePanLocked,
          padding: FOCUS_PADDING,
        });
        return;
      }
    }
    const bounds = getPrimitiveBounds(selectedPrimitive, primitivesById);
    if (bounds) {
      fitBBox(viewer, bounds, dims, {
        locked: effectiveZoomLocked,
        frozen: effectivePanLocked,
        padding: FOCUS_PADDING,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPrimitiveId, selectedOccurrenceIndex, selectionGeomKey, viewer, effectiveZoomLocked, effectivePanLocked, zoomTarget, dims.width, dims.height, compareOnly]);

  useEffect(() => {
    if (editorMode !== 'polygon') return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && draftPolygonPoints.length >= 2) {
        const id = addPrimitive({
          name: `Polyline ${workspace.primitives.length + 1}`,
          kind: 'customline',
          showLabel: false,
          color: draftOverlayColor,
          tags: [],
          notes: [],
          points: draftPolygonPoints,
        });
        clearDraftPolygon();
        setDraftPointer(null);
        setEditorMode('none');
        setSelectedPrimitive(id);
      }
      if (event.key === 'Escape') {
        clearDraftPolygon();
        setDraftPointer(null);
        setEditorMode('none');
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [
    editorMode,
    draftPolygonPoints,
    draftOverlayColor,
    workspace.primitives.length,
    addPrimitive,
    clearDraftPolygon,
    setEditorMode,
    setSelectedPrimitive,
  ]);

  const toNormalizedPoint = (event: React.PointerEvent<SVGRectElement>) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const bounds = svg.getBoundingClientRect();
    return viewerElementPointToNormalizedPoint(
      viewer,
      event.clientX - bounds.left,
      event.clientY - bounds.top,
      dims
    );
  };

  const handleEditorPointerDown = (event: React.PointerEvent<SVGRectElement>) => {
    if (editorMode === 'none') return;
    const point = toNormalizedPoint(event);
    if (!point) return;

    if (editorMode === 'polygon') {
      // close polygon if clicked near first point
      if (draftPolygonPoints.length >= 3) {
        const first = draftPolygonPoints[0];
        if (Math.hypot(first.x - point.x, first.y - point.y) < 0.012) {
          const id = addPrimitive({
            name: `Region ${workspace.primitives.length + 1}`,
            kind: 'polygon',
            showLabel: false,
            color: draftOverlayColor,
            tags: [],
            notes: [],
            points: draftPolygonPoints,
          });
          clearDraftPolygon();
          setDraftPointer(null);
          setEditorMode('none');
          setSelectedPrimitive(id);
          return;
        }
      }
      addDraftPolygonPoint(point);
      return;
    }

    if (editorMode === 'rectangle') {
      setDraftRectangleStart(point);
      setDraftPointer(point);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const handleEditorPointerMove = (event: React.PointerEvent<SVGRectElement>) => {
    if (editorMode === 'none') return;
    const point = toNormalizedPoint(event);
    if (!point) return;
    setDraftPointer(point);
  };

  const handleEditorPointerUp = (event: React.PointerEvent<SVGRectElement>) => {
    if (editorMode !== 'rectangle') return;
    const start = draftRectangleStart;
    const end = toNormalizedPoint(event);
    if (!start || !end) return;
    const bbox = bboxFromPoints(start, end);
    setDraftRectangleStart(null);
    setDraftPointer(null);

    // Always exit drawing mode on release — even if too small to commit.
    setEditorMode('none');
    if (bbox.w < 0.002 || bbox.h < 0.002) return;
    addPrimitive({
      name: `Study box ${workspace.primitives.length + 1}`,
      kind: 'rectangle',
      showLabel: false,
      color: draftOverlayColor,
      tags: [],
      notes: [],
      bbox,
    });
  };

  const polygonDraftPoints =
    draftPointer && editorMode === 'polygon'
      ? [...draftPolygonPoints, draftPointer]
      : draftPolygonPoints;
  const rectangleDraft =
    draftRectangleStart && draftPointer
      ? bboxFromPoints(draftRectangleStart, draftPointer)
      : null;
  const overlaySelectionMode =
    editorMode === 'groupCollect' || editorMode === 'overlayNeighborPick';

  const activatePrimitive = useCallback(
    (primitive: Primitive) => {
      if (!isMapSelectablePrimitive(primitive)) return;
      if (compareOnly && compareBacklinkPickActive) {
        onPickCompareBacklinkTarget?.(primitive.id);
        return;
      }
      if (overlaySelectionMode && primitive.id !== overlayNeighborTargetId) {
        if (editorMode === 'groupCollect') {
          if (!isStudyBoxPrimitive(primitive)) return;
          if (groupCollectTargetId) {
            addGroupMember(groupCollectTargetId, makeMemberKey(primitive.id));
          } else {
            addDraftGroupMember(makeMemberKey(primitive.id));
          }
        } else if (editorMode === 'overlayNeighborPick') {
          if (
            overlayNeighborTargetId &&
            overlayNeighborTargetPageIndex !== null &&
            activeMapId
          ) {
            void (async () => {
              const added = await addPrimitiveBacklink(
                activeMapId,
                overlayNeighborTargetPageIndex,
                overlayNeighborTargetId,
                activeMapId,
                activePageIndex,
                primitive.id
              );
              if (added) {
                setLinkFlash({ primitiveId: primitive.id, nonce: Date.now() });
              }
              await setActivePage(overlayNeighborTargetPageIndex);
              setSelectedPrimitive(overlayNeighborTargetId);
              setEditorMode('none');
            })();
          } else {
            addNeighborMember(makeMemberKey(primitive.id));
          }
        }
        return;
      }
      setSelectedPrimitive(primitive.id);
    },
    [
      compareOnly,
      compareBacklinkPickActive,
      onPickCompareBacklinkTarget,
      overlaySelectionMode,
      overlayNeighborTargetId,
      overlayNeighborTargetPageIndex,
      groupCollectTargetId,
      activeMapId,
      activePageIndex,
      editorMode,
      addDraftGroupMember,
      addGroupMember,
      addNeighborMember,
      addPrimitiveBacklink,
      setActivePage,
      setSelectedPrimitive,
      setEditorMode,
    ]
  );

  const beginInteractiveDrag = useCallback(
    (event: React.PointerEvent<SVGElement>, activate: () => void) => {
      if (compareOnly && compareBacklinkPickActive) {
        event.preventDefault();
        event.stopPropagation();
        activate();
        return;
      }
      if (spacePanActive || (editorMode !== 'none' && !overlaySelectionMode)) return;
      if (effectivePanLocked) {
        activate();
        return;
      }
      onMapDragActiveChange(true);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: false,
        activate,
      };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    },
    [
      compareOnly,
      compareBacklinkPickActive,
      editorMode,
      overlaySelectionMode,
      effectivePanLocked,
      spacePanActive,
      onMapDragActiveChange,
    ]
  );

  const continueInteractiveDrag = useCallback(
    (event: React.PointerEvent<SVGElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.lastX;
      const dy = event.clientY - drag.lastY;
      const total = Math.hypot(
        event.clientX - drag.startX,
        event.clientY - drag.startY
      );
      if (!drag.moved && total > 4) drag.moved = true;
      if (!drag.moved) return;
      const delta = viewer.viewport.deltaPointsFromPixels(
        new OpenSeadragon.Point(-dx, -dy),
        true
      );
      if (effectivePanLocked) return;
      viewer.viewport.panBy(delta, true);
      viewer.viewport.applyConstraints();
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
    },
    [viewer, effectivePanLocked]
  );

  const endInteractiveDrag = useCallback(
    (event: React.PointerEvent<SVGElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      onMapDragActiveChange(false);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      if (!drag.moved) drag.activate();
    },
    [onMapDragActiveChange]
  );

  const cancelInteractiveDrag = useCallback(
    (event: React.PointerEvent<SVGElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      onMapDragActiveChange(false);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    },
    [onMapDragActiveChange]
  );

  const beginBackgroundDrag = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (event.target !== event.currentTarget) return;
      beginInteractiveDrag(event, () => {});
    },
    [beginInteractiveDrag]
  );

  const continueBackgroundDrag = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (event.target !== event.currentTarget && !dragRef.current) return;
      continueInteractiveDrag(event);
    },
    [continueInteractiveDrag]
  );

  const endBackgroundDrag = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (event.target !== event.currentTarget && !dragRef.current) return;
      endInteractiveDrag(event);
    },
    [endInteractiveDrag]
  );

  const cancelBackgroundDrag = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (event.target !== event.currentTarget && !dragRef.current) return;
      cancelInteractiveDrag(event);
    },
    [cancelInteractiveDrag]
  );

  const beginPriorityBubbleDrag = useCallback(
    (
      event: React.PointerEvent<SVGRectElement | SVGTextElement | SVGGElement>,
      primitiveId: string
    ) => {
      if (movePriorityPrimitiveId !== primitiveId) return;
      event.preventDefault();
      event.stopPropagation();
      const bubble = priorityBubbles.find((entry) => entry.primitiveId === primitiveId);
      if (!bubble) return;
      const svg = svgRef.current;
      if (!svg) return;
      const bounds = svg.getBoundingClientRect();
      const pointerX = event.clientX - bounds.left;
      const pointerY = event.clientY - bounds.top;
      const topCenterX = bubble.x + bubble.width / 2;
      const topY = bubble.y;
      priorityBubbleDragRef.current = {
        pointerId: event.pointerId,
        primitiveId,
        anchorOffsetX: pointerX - topCenterX,
        anchorOffsetY: pointerY - topY,
      };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    },
    [movePriorityPrimitiveId, priorityBubbles]
  );

  const togglePriorityBubbleCollapsed = useCallback(
    (
      event: React.PointerEvent<
        SVGCircleElement | SVGTextElement | SVGRectElement | SVGGElement
      >,
      primitiveId: string,
      collapsed: boolean
    ) => {
      event.preventDefault();
      event.stopPropagation();
      if (compareOnly) {
        onComparePrimitivePatch?.(primitiveId, {
          priorityNoteCollapsed: !collapsed,
        });
        return;
      }
      updatePrimitive(primitiveId, {
        priorityNoteCollapsed: !collapsed,
      });
    },
    [compareOnly, onComparePrimitivePatch, updatePrimitive]
  );

  const togglePriorityBubbleMoveMode = useCallback(
    (
      event: React.PointerEvent<SVGGElement | SVGCircleElement | SVGTextElement>,
      primitiveId: string
    ) => {
      event.preventDefault();
      event.stopPropagation();
      setMovePriorityPrimitiveId((current) =>
        current === primitiveId ? null : primitiveId
      );
    },
    []
  );

  const beginPriorityBubbleEdit = useCallback(
    (
      event:
        | React.MouseEvent<SVGRectElement | SVGTextElement | SVGGElement>
        | React.PointerEvent<SVGRectElement | SVGGElement>,
      primitiveId: string
    ) => {
      event.preventDefault();
      event.stopPropagation();
      const primitive = primitivesById.get(primitiveId);
      const note = getPriorityNote(primitive ?? null);
      if (!note) return;
      setEditingPriorityPrimitiveId(primitiveId);
      setEditingPriorityDraft(note.content);
    },
    [primitivesById]
  );

  const commitPriorityBubbleEdit = useCallback(() => {
    if (!editingPriorityPrimitiveId) return;
    const primitive = primitivesById.get(editingPriorityPrimitiveId);
    const noteIndex = getPriorityNoteIndex(primitive ?? null);
    if (!primitive || noteIndex < 0) {
      setEditingPriorityPrimitiveId(null);
      setEditingPriorityDraft('');
      return;
    }
    const nextContent = editingPriorityDraft.trim();
    const currentNotes = primitive.notes ?? [];
    if (currentNotes[noteIndex]?.content !== nextContent) {
      const nextNotes = currentNotes.map((note, index) =>
        index === noteIndex ? { ...note, content: nextContent } : note
      );
      const patch = { notes: nextNotes };
      if (compareOnly) {
        onComparePrimitivePatch?.(editingPriorityPrimitiveId, patch);
      } else {
        updatePrimitive(editingPriorityPrimitiveId, patch);
      }
    }
    setEditingPriorityPrimitiveId(null);
    setEditingPriorityDraft('');
  }, [
    compareOnly,
    editingPriorityDraft,
    editingPriorityPrimitiveId,
    onComparePrimitivePatch,
    primitivesById,
    updatePrimitive,
  ]);

  const continuePriorityBubbleDrag = useCallback(
    (event: React.PointerEvent<SVGRectElement | SVGTextElement | SVGGElement>) => {
      const drag = priorityBubbleDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const svg = svgRef.current;
      if (!svg) return;
      const bounds = svg.getBoundingClientRect();
      const pointerX = event.clientX - bounds.left;
      const pointerY = event.clientY - bounds.top;
      const topCenterX = pointerX - drag.anchorOffsetX;
      const topY = pointerY - drag.anchorOffsetY;
      const normalized = viewerElementPointToNormalizedPoint(
        viewer,
        topCenterX,
        topY,
        dims
      );
      if (!normalized) return;
      setPriorityBubbleDraftAnchors((current) => ({
        ...current,
        [drag.primitiveId]: {
          x: clamp(normalized.x, 0.02, 0.98),
          y: clamp(normalized.y, 0.02, 0.98),
        },
      }));
    },
    [viewer, dims]
  );

  const endPriorityBubbleDrag = useCallback(
    (event: React.PointerEvent<SVGRectElement | SVGTextElement | SVGGElement>) => {
      const drag = priorityBubbleDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      const nextAnchor = priorityBubbleDraftAnchors[drag.primitiveId];
      if (nextAnchor) {
        const primitive = primitivesById.get(drag.primitiveId);
        if (primitive) {
          if (compareOnly) {
            onComparePrimitivePatch?.(drag.primitiveId, {
              priorityNoteAnchor: nextAnchor,
              priorityNoteOffset: undefined,
            });
          } else {
            const { priorityNoteOffset: _priorityNoteOffset, ...rest } = primitive;
            updatePrimitive(drag.primitiveId, {
              ...rest,
              priorityNoteAnchor: nextAnchor,
            });
          }
        }
      }
      setPriorityBubbleDraftAnchors((current) => {
        const next = { ...current };
        delete next[drag.primitiveId];
        return next;
      });
      priorityBubbleDragRef.current = null;
      setMovePriorityPrimitiveId(null);
    },
    [compareOnly, onComparePrimitivePatch, priorityBubbleDraftAnchors, primitivesById, updatePrimitive]
  );

  const cancelPriorityBubbleDrag = useCallback(
    (event: React.PointerEvent<SVGRectElement | SVGTextElement | SVGGElement>) => {
      const drag = priorityBubbleDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      setPriorityBubbleDraftAnchors((current) => {
        const next = { ...current };
        delete next[drag.primitiveId];
        return next;
      });
      priorityBubbleDragRef.current = null;
      setMovePriorityPrimitiveId(null);
    },
    []
  );

  // re-render markers when viewport changes
  void viewTick;
  const activeLinkFlash = compareOnly ? compareLinkFlash : linkFlash;
  const activeLinkConfirmIds = compareOnly ? compareLinkConfirmIds : linkConfirmIds;

  if (!compareOnly && editorMode === 'textSelect') return null;

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 h-full w-full"
      viewBox={`0 0 ${viewportSize.w} ${viewportSize.h}`}
      preserveAspectRatio="none"
      style={{ overflow: 'visible' }}
      onPointerDown={beginBackgroundDrag}
      onPointerMove={continueBackgroundDrag}
      onPointerUp={endBackgroundDrag}
      onPointerCancel={cancelBackgroundDrag}
    >
      <defs>
        <filter id="hotspot-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="0" stdDeviation="3" floodOpacity="0.45" />
        </filter>
      </defs>

      <g className="pointer-events-none">
        {primitiveShapes.map(({ primitive, bounds }) => {
          const boundsRect = bboxToViewerElementRect(viewer, bounds, dims);
          if (!boundsRect) return null;
          const isSelected = selectedPrimitiveId === primitive.id;
          const isHovered = hoveredPrimitiveId === primitive.id;
          const isGroupMember = selectedGroupTargets.some(
            (entry) => entry.id === primitive.id
          );
          const isSameNameMatch = selectedNameTargets.some((entry) => entry.id === primitive.id);
          const showGroupNumbers =
            selectedPrimitive?.kind === 'group' &&
            selectedPrimitive.showMemberNumbers === true;
          const groupEntry = selectedGroupTargets.find((e) => e.id === primitive.id);
          const isVisible =
            (compareOnly
              ? compareShowAllOverlays ||
                primitiveMatchesFilter(primitive, compareVisibleOverlayFilters)
              : primitiveMatchesFilter(primitive, visibleOverlayFilters)) ||
            primitive.showOnLoad === true ||
            isSelected ||
            isHovered ||
            isGroupMember ||
            isSameNameMatch;

          const activeFocusId =
            selectedPrimitive?.kind === 'group'
              ? selectedGroupTargets[
                  Math.min(selectedOccurrenceIndex, selectedGroupTargets.length - 1)
                ]?.id ?? null
              : selectedNameTargets.length > 1
                ? selectedPrimitiveId
                : null;
          const isLinkConfirmed = activeLinkConfirmIds.includes(primitive.id);

          const memberNumberBadge =
            !simplifyOverlay && showGroupNumbers && groupEntry ? (
              <g pointerEvents="none">
                <rect
                  x={boundsRect.x - 4}
                  y={boundsRect.y - 8}
                  width={18}
                  height={18}
                  rx={9}
                  fill="#ffffff"
                  stroke={selectedPrimitive?.color ?? primitive.color}
                  strokeWidth={2}
                />
                <text
                  x={boundsRect.x + 5}
                  y={boundsRect.y + 5}
                  fill={selectedPrimitive?.color ?? primitive.color}
                  fontSize={11}
                  fontWeight={700}
                  textAnchor="middle"
                >
                  {groupEntry.order}
                </text>
              </g>
            ) : null;

          const focusDot =
            !simplifyOverlay && (activeFocusId === primitive.id || isLinkConfirmed) ? (
              <circle
                cx={boundsRect.x + boundsRect.width - 4}
                cy={boundsRect.y + 4}
                r={6}
                fill={isLinkConfirmed ? '#16a34a' : '#dc2626'}
                stroke="#ffffff"
                strokeWidth={2}
                pointerEvents="none"
              />
            ) : null;

          const interactiveStyle = {
            pointerEvents:
              spacePanActive ||
              (editorMode !== 'none' && !overlaySelectionMode) ||
              !isMapSelectablePrimitive(primitive)
                ? ('none' as const)
                : ('all' as const),
            cursor:
              compareOnly && compareBacklinkPickActive
                ? 'pointer'
                : mapDragActive
                ? 'grabbing'
                : 'pointer',
          };

          if (primitive.kind === 'customline' && primitive.points?.length) {
            const points = primitive.points
              .map((point) => normalizedPointToViewerElementPoint(viewer, point, dims))
              .filter((p): p is OpenSeadragon.Point => p !== null);
            if (points.length < 2) return null;
            return (
              <g key={primitive.id}>
                <polyline
                  points={points.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke={isVisible ? primitive.color : 'transparent'}
                  strokeWidth={isVisible ? (isSelected ? 3 : 2) : 14}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray={isSelected ? undefined : '8 5'}
                  style={interactiveStyle}
                  onPointerDown={(event) =>
                    beginInteractiveDrag(event, () => activatePrimitive(primitive))
                  }
                  onPointerMove={continueInteractiveDrag}
                  onPointerUp={endInteractiveDrag}
                  onPointerCancel={cancelInteractiveDrag}
                  onMouseEnter={() => setHoveredPrimitiveId(primitive.id)}
                  onMouseLeave={() => setHoveredPrimitiveId(null)}
                />
                {isVisible &&
                  points.map((point, index) => (
                    <circle
                      key={`${primitive.id}-pt-${index}`}
                      cx={point.x}
                      cy={point.y}
                      r={isSelected ? 4 : 3}
                      fill={primitive.color}
                      stroke="#fff"
                      strokeWidth={1}
                      style={{ pointerEvents: 'none' }}
                    />
                  ))}
                {memberNumberBadge}
                {focusDot}
                {!simplifyOverlay && isVisible && primitive.showLabel === true && (
                  <text
                    x={boundsRect.x}
                    y={boundsRect.y - 8}
                    fill={primitive.color}
                    fontSize={12}
                    fontWeight={700}
                    pointerEvents="none"
                  >
                    {primitive.name}
                  </text>
                )}
              </g>
            );
          }

          if (primitive.kind === 'polygon' && primitive.points?.length) {
            const points = primitive.points
              .map((point) => normalizedPointToViewerElementPoint(viewer, point, dims))
              .filter((p): p is OpenSeadragon.Point => p !== null);
            if (points.length < 3) return null;
            return (
              <g key={primitive.id}>
                <polygon
                  points={points.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill={isVisible ? `${primitive.color}22` : 'transparent'}
                  stroke={isVisible ? primitive.color : 'transparent'}
                  strokeWidth={isSelected ? 3 : 2}
                  strokeLinejoin="round"
                  strokeDasharray={isSelected ? undefined : '8 5'}
                  style={interactiveStyle}
                  onPointerDown={(event) =>
                    beginInteractiveDrag(event, () => activatePrimitive(primitive))
                  }
                  onPointerMove={continueInteractiveDrag}
                  onPointerUp={endInteractiveDrag}
                  onPointerCancel={cancelInteractiveDrag}
                  onMouseEnter={() => setHoveredPrimitiveId(primitive.id)}
                  onMouseLeave={() => setHoveredPrimitiveId(null)}
                />
                {memberNumberBadge}
                {focusDot}
                {!simplifyOverlay && isVisible && primitive.showLabel === true && (
                  <text
                    x={boundsRect.x}
                    y={boundsRect.y - 8}
                    fill={primitive.color}
                    fontSize={12}
                    fontWeight={700}
                    pointerEvents="none"
                  >
                    {primitive.name}
                  </text>
                )}
              </g>
            );
          }

          // group
          if (primitive.kind === 'group') {
            return (
              <g key={primitive.id}>
                {focusDot}
                {!simplifyOverlay && isVisible && primitive.showLabel === true && (
                  <text
                    x={boundsRect.x + 8}
                    y={boundsRect.y - 8}
                    fill={primitive.color}
                    fontSize={12}
                    fontWeight={700}
                  >
                    {primitive.name}
                  </text>
                )}
              </g>
            );
          }

          // rectangle
          return (
            <g key={primitive.id}>
              <rect
                x={boundsRect.x}
                y={boundsRect.y}
                width={boundsRect.width}
                height={boundsRect.height}
                rx={12}
                fill={
                  isVisible
                    ? isSelected
                      ? `${primitive.color}44`
                      : `${primitive.color}18`
                    : 'transparent'
                }
                stroke={
                  isVisible
                    ? isSelected
                      ? '#7f1d1d'
                      : primitive.color
                    : 'transparent'
                }
                strokeWidth={isSelected ? 3.5 : 2}
                style={interactiveStyle}
                onPointerDown={(event) =>
                  beginInteractiveDrag(event, () => activatePrimitive(primitive))
                }
                onPointerMove={continueInteractiveDrag}
                onPointerUp={endInteractiveDrag}
                onPointerCancel={cancelInteractiveDrag}
                onMouseEnter={() => setHoveredPrimitiveId(primitive.id)}
                onMouseLeave={() => setHoveredPrimitiveId(null)}
              />
              {memberNumberBadge}
              {focusDot ?? (!simplifyOverlay && isSelected && primitive.kind === 'rectangle' ? (
                <circle
                  cx={boundsRect.x + boundsRect.width - 4}
                  cy={boundsRect.y + 4}
                  r={6}
                  fill={isLinkConfirmed ? '#16a34a' : '#dc2626'}
                  stroke="#ffffff"
                  strokeWidth={2}
                  pointerEvents="none"
                />
              ) : null)}
              {/* Always-visible label for rectangles when name set + showLabel */}
              {!simplifyOverlay &&
                isVisible &&
                primitive.kind === 'rectangle' &&
                primitive.name &&
                primitive.showLabel === true && (
                  <g pointerEvents="none">
                    <rect
                      x={boundsRect.x}
                      y={boundsRect.y - 18}
                      width={measureTextWidth(primitive.name, '600 11px system-ui, -apple-system, sans-serif') + 16}
                      height={16}
                      rx={3}
                      fill={primitive.color}
                      opacity={0.9}
                    />
                    <text
                      x={boundsRect.x + 8}
                      y={boundsRect.y - 5}
                      fill="white"
                      fontSize={11}
                      fontWeight={600}
                      style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
                    >
                      {primitive.name}
                    </text>
                  </g>
                )}
            </g>
          );
        })}
      </g>

      {/* Highlight ring for group-member primitives */}
      {!simplifyOverlay && (
        <g className="pointer-events-none">
          {selectedGroupTargets.map((entry) => {
          const rect = bboxToViewerElementRect(viewer, entry.bbox, dims);
          if (!rect) return null;
          return (
            <rect
              key={`ring-${entry.key}`}
              x={rect.x - 4}
              y={rect.y - 4}
              width={rect.width + 8}
              height={rect.height + 8}
              rx={8}
              fill="none"
              stroke="#ffffff"
              strokeWidth={2}
              opacity={0.95}
            />
          );
        })}
        </g>
      )}

      {!simplifyOverlay && (
        <g className="pointer-events-none">
          {selectedPrimitive?.kind !== 'group' &&
            selectedNameTargets.length > 1 &&
            selectedNameTargets.map((entry) => {
            const rect = bboxToViewerElementRect(viewer, entry.bbox, dims);
            if (!rect) return null;
            return (
              <rect
                key={`name-ring-${entry.id}`}
                x={rect.x - 4}
                y={rect.y - 4}
                width={rect.width + 8}
                height={rect.height + 8}
                rx={8}
                fill="none"
                stroke="#ffffff"
                strokeWidth={2}
                opacity={0.95}
              />
            );
          })}
        </g>
      )}

      {activeLinkFlash && (() => {
        const primitive = primitivesById.get(activeLinkFlash.primitiveId);
        if (!primitive) return null;
        const bounds = getPrimitiveBounds(primitive, primitivesById);
        if (!bounds) return null;
        const rect = bboxToViewerElementRect(viewer, bounds, dims);
        if (!rect) return null;
        const x = rect.x + rect.width / 2;
        const y = rect.y - 10;
        return (
          <g
            className="pointer-events-none"
            key={`link-flash-${activeLinkFlash.primitiveId}-${activeLinkFlash.nonce}`}
          >
            <text
              x={x}
              y={y}
              textAnchor="middle"
              fill="#0f172a"
              fontSize={16}
              fontWeight={800}
              style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
            >
              {'< >'}
              <animate
                attributeName="opacity"
                values="0;1;1;0"
                dur="0.7s"
                fill="freeze"
              />
              <animate
                attributeName="transform"
                type="translate"
                values="0 8;0 0;0 0;0 -6"
                dur="0.7s"
                fill="freeze"
              />
            </text>
          </g>
        );
      })()}

      {priorityBubbles.map((priorityBubble) => (
          <g key={`priority-bubble-${priorityBubble.primitiveId}`}>
            {(() => {
              const isEditing = editingPriorityPrimitiveId === priorityBubble.primitiveId;
              const isMoveArmed = movePriorityPrimitiveId === priorityBubble.primitiveId;
              return (
                <>
            {priorityBubble.collapsed ? (
              <g
                style={{ cursor: 'pointer' }}
                onPointerDown={(event) =>
                  togglePriorityBubbleCollapsed(
                    event,
                    priorityBubble.primitiveId,
                    priorityBubble.collapsed
                  )
                }
              >
                <path
                  d={[
                    `M ${priorityBubble.x + 7} ${priorityBubble.y}`,
                    `H ${priorityBubble.x + priorityBubble.width - 7}`,
                    `Q ${priorityBubble.x + priorityBubble.width} ${priorityBubble.y} ${
                      priorityBubble.x + priorityBubble.width
                    } ${priorityBubble.y + 7}`,
                    `V ${priorityBubble.y + priorityBubble.height - 8}`,
                    `Q ${priorityBubble.x + priorityBubble.width} ${
                      priorityBubble.y + priorityBubble.height
                    } ${priorityBubble.x + priorityBubble.width - 7} ${
                      priorityBubble.y + priorityBubble.height
                    }`,
                    `H ${priorityBubble.x + 16}`,
                    `L ${priorityBubble.x + 10} ${priorityBubble.y + priorityBubble.height + 6}`,
                    `L ${priorityBubble.x + 11} ${priorityBubble.y + priorityBubble.height}`,
                    `H ${priorityBubble.x + 7}`,
                    `Q ${priorityBubble.x} ${priorityBubble.y + priorityBubble.height} ${
                      priorityBubble.x
                    } ${priorityBubble.y + priorityBubble.height - 8}`,
                    `V ${priorityBubble.y + 7}`,
                    `Q ${priorityBubble.x} ${priorityBubble.y} ${priorityBubble.x + 7} ${
                      priorityBubble.y
                    }`,
                    'Z',
                  ].join(' ')}
                  fill="#fff8eb"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  filter="url(#hotspot-glow)"
                />
                <text
                  x={priorityBubble.x + 8}
                  y={priorityBubble.y + 14}
                  fill="#b45309"
                  fontSize={11}
                  fontWeight={700}
                  letterSpacing="1"
                  style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
                  pointerEvents="none"
                >
                  ...
                </text>
              </g>
            ) : (
              <rect
                x={priorityBubble.x}
                y={priorityBubble.y}
                width={priorityBubble.width}
                height={priorityBubble.height}
                rx={18}
                fill="#fff8eb"
                stroke="#f59e0b"
                strokeWidth={2}
                filter="url(#hotspot-glow)"
                style={{
                  cursor: isMoveArmed
                    ? priorityBubbleDragRef.current?.primitiveId === priorityBubble.primitiveId
                      ? 'grabbing'
                      : 'grab'
                    : 'text',
                }}
                onPointerDown={(event) =>
                  beginPriorityBubbleDrag(event, priorityBubble.primitiveId)
                }
                onPointerMove={continuePriorityBubbleDrag}
                onPointerUp={endPriorityBubbleDrag}
                onPointerCancel={cancelPriorityBubbleDrag}
                onDoubleClick={(event) =>
                  beginPriorityBubbleEdit(event, priorityBubble.primitiveId)
                }
              />
            )}
            {!isEditing && (
              <>
                {!priorityBubble.collapsed && (
                  <>
                    <circle
                      cx={priorityBubble.x + priorityBubble.width - 14}
                      cy={priorityBubble.y + priorityBubble.height - 14}
                      r={8}
                      fill="#fff8eb"
                      stroke="#f59e0b"
                      strokeWidth={1.5}
                      style={{ cursor: 'pointer' }}
                      onPointerDown={(event) =>
                        togglePriorityBubbleCollapsed(
                          event,
                          priorityBubble.primitiveId,
                          priorityBubble.collapsed
                        )
                      }
                    />
                    <text
                      x={priorityBubble.x + priorityBubble.width - 14}
                      y={priorityBubble.y + priorityBubble.height - 10}
                      fill="#b45309"
                      fontSize={11}
                      fontWeight={700}
                      textAnchor="middle"
                      style={{ cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif' }}
                      onPointerDown={(event) =>
                        togglePriorityBubbleCollapsed(
                          event,
                          priorityBubble.primitiveId,
                          priorityBubble.collapsed
                        )
                      }
                    >
                      ◉
                    </text>
                    <g
                      transform={`translate(${priorityBubble.x + priorityBubble.width - 36} ${priorityBubble.y + priorityBubble.height - 14})`}
                      style={{ cursor: 'pointer' }}
                      onPointerDown={(event) =>
                        beginPriorityBubbleEdit(event, priorityBubble.primitiveId)
                      }
                    >
                      <circle cx={0} cy={0} r={8} fill="#fff8eb" stroke="#f59e0b" strokeWidth={1.5} />
                      <path
                        d="M 2,-4 L 3.5,-2.5 L -2.5,3 L -4,1.5 Z M 2,-4 L 3.5,-2.5 L 4.5,-3.5 Z M -2.5,3 L -4,1.5 L -5,2.5 L -3.5,4 Z"
                        fill="#b45309"
                        pointerEvents="none"
                      />
                    </g>
                    <g
                      transform={`translate(${priorityBubble.x + priorityBubble.width - 58} ${priorityBubble.y + priorityBubble.height - 14})`}
                      style={{
                        cursor: isMoveArmed
                          ? priorityBubbleDragRef.current?.primitiveId === priorityBubble.primitiveId
                            ? 'grabbing'
                            : 'grab'
                          : 'pointer',
                      }}
                      onPointerDown={(event) =>
                        togglePriorityBubbleMoveMode(event, priorityBubble.primitiveId)
                      }
                    >
                      <circle
                        cx={0}
                        cy={0}
                        r={8}
                        fill={isMoveArmed ? '#f59e0b' : '#fff8eb'}
                        stroke="#f59e0b"
                        strokeWidth={1.5}
                      />
                      <text
                        x={0}
                        y={4}
                        fill={isMoveArmed ? '#ffffff' : '#b45309'}
                        fontSize={10}
                        fontWeight={700}
                        textAnchor="middle"
                        pointerEvents="none"
                        style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
                      >
                        {isMoveArmed ? '✊' : '✋'}
                      </text>
                    </g>
                    {priorityBubble.backlinkKeys.length > 0 && (
                      <g
                        transform={`translate(${priorityBubble.x + priorityBubble.width - 92} ${priorityBubble.y + priorityBubble.height - 14})`}
                        pointerEvents="none"
                      >
                        {/* pill background */}
                        <rect x={-20} y={-8} width={40} height={16} rx={8} fill="#fff8eb" stroke="#f59e0b" strokeWidth={1.5}/>
                        {/* chain link icon: two oblique rotated rounded rects */}
                        <g transform="translate(-8,0) rotate(-35) scale(0.82)" fill="none" stroke="#b45309" strokeWidth={1.6} strokeLinecap="round" pointerEvents="none">
                          <rect x="-4.8" y="-1.8" width="5.2" height="3.6" rx="1.8"/>
                          <rect x="-0.4" y="-1.8" width="5.2" height="3.6" rx="1.8"/>
                        </g>
                        {/* link count */}
                        <text
                          x={8}
                          y={4}
                          textAnchor="middle"
                          fill="#b45309"
                          fontSize={11}
                          fontWeight={700}
                          pointerEvents="none"
                          style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
                        >
                          {priorityBubble.backlinkKeys.length}
                        </text>
                      </g>
                    )}
                  </>
                )}
              </>
            )}
            {!priorityBubble.collapsed && (
              <>
                {!isEditing && (
                  <text
                    x={priorityBubble.x + PRIORITY_BUBBLE_PADDING_X}
                    y={priorityBubble.y + PRIORITY_BUBBLE_PADDING_TOP}
                    fill="#7c2d12"
                    fontSize={12}
                    fontWeight={600}
                    style={{
                      fontFamily: 'system-ui, -apple-system, sans-serif',
                      cursor: isMoveArmed
                        ? priorityBubbleDragRef.current?.primitiveId === priorityBubble.primitiveId
                          ? 'grabbing'
                          : 'grab'
                        : 'text',
                    }}
                    onPointerDown={(event) =>
                      beginPriorityBubbleDrag(event, priorityBubble.primitiveId)
                    }
                    onPointerMove={continuePriorityBubbleDrag}
                    onPointerUp={endPriorityBubbleDrag}
                    onPointerCancel={cancelPriorityBubbleDrag}
                    onDoubleClick={(event) =>
                      beginPriorityBubbleEdit(event, priorityBubble.primitiveId)
                    }
                  >
                    {priorityBubble.lines.map((line, index) => (
                      <tspan
                        key={`${priorityBubble.primitiveId}-priority-line-${index}`}
                        x={priorityBubble.x + PRIORITY_BUBBLE_PADDING_X}
                        dy={index === 0 ? 0 : PRIORITY_BUBBLE_LINE_HEIGHT}
                      >
                        {line}
                      </tspan>
                    ))}
                  </text>
                )}
                {isEditing && (
                  <foreignObject
                    x={priorityBubble.x + PRIORITY_BUBBLE_PADDING_X}
                    y={priorityBubble.y + 8}
                    width={priorityBubble.width - PRIORITY_BUBBLE_PADDING_X * 2}
                    height={priorityBubble.height - 12}
                  >
                    <textarea
                      autoFocus
                      value={editingPriorityDraft}
                      onChange={(event) => setEditingPriorityDraft(event.target.value)}
                      onBlur={commitPriorityBubbleEdit}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                      }}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                      }}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          setEditingPriorityPrimitiveId(null);
                          setEditingPriorityDraft('');
                        }
                        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                          event.preventDefault();
                          commitPriorityBubbleEdit();
                        }
                      }}
                      style={{
                        width: '100%',
                        height: '100%',
                        margin: '0',
                        padding: '14px 0 14px 0',
                        boxSizing: 'border-box',
                        resize: 'none',
                        border: 'none',
                        outline: 'none',
                        background: '#fff8eb',
                        color: '#7c2d12',
                        fontFamily: 'system-ui, -apple-system, sans-serif',
                        fontSize: '12px',
                        fontWeight: 600,
                        lineHeight: '16px',
                      }}
                    />
                  </foreignObject>
                )}
              </>
            )}
                </>
              );
            })()}
          </g>
        ))}

      {!compareOnly &&
        editorMode !== 'none' &&
        editorMode !== 'groupCollect' &&
        editorMode !== 'overlayNeighborPick' && (
          <g>
            <rect
              x={0}
              y={0}
              width={viewportSize.w}
              height={viewportSize.h}
              fill="transparent"
              onPointerDown={handleEditorPointerDown}
              onPointerMove={handleEditorPointerMove}
              onPointerUp={handleEditorPointerUp}
              style={{ cursor: 'crosshair' }}
            />
            {polygonDraftPoints.length > 0 && (
              <>
                <polyline
                  points={polygonDraftPoints
                    .map((point) =>
                      normalizedPointToViewerElementPoint(viewer, point, dims)
                    )
                    .filter((p): p is OpenSeadragon.Point => p !== null)
                    .map((p) => `${p.x},${p.y}`)
                    .join(' ')}
                  fill="none"
                  stroke={draftOverlayColor}
                  strokeWidth={3}
                  strokeLinejoin="round"
                  style={{ pointerEvents: 'none' }}
                />
                {draftPolygonPoints.map((point, index) => {
                  const drawPoint = normalizedPointToViewerElementPoint(
                    viewer,
                    point,
                    dims
                  );
                  if (!drawPoint) return null;
                  return (
                    <circle
                      key={`${point.x}:${point.y}:${index}`}
                      cx={drawPoint.x}
                      cy={drawPoint.y}
                      r={index === 0 ? 6 : 4}
                      fill={index === 0 ? '#fff' : draftOverlayColor}
                      stroke={draftOverlayColor}
                      strokeWidth={2}
                      style={{ pointerEvents: 'none' }}
                    />
                  );
                })}
              </>
            )}
            {rectangleDraft &&
              (() => {
                const rect = bboxToViewerElementRect(viewer, rectangleDraft, dims);
                if (!rect) return null;
                return (
                  <rect
                    x={rect.x}
                    y={rect.y}
                    width={rect.width}
                    height={rect.height}
                    fill={`${draftOverlayColor}22`}
                    stroke={draftOverlayColor}
                    strokeWidth={2}
                    strokeDasharray="8 4"
                    pointerEvents="none"
                  />
                );
              })()}
          </g>
        )}
    </svg>
  );
}
