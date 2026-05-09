import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';
import {
  bboxToViewerElementRect,
  fitBBox,
  normalizedPointToViewerElementPoint,
  viewerElementPointToNormalizedPoint,
  type SourceDims,
} from '../lib/coords';
import { useEditorStore, type OverlayFilterState } from '../lib/store';
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
  compareZoomLocked?: boolean;
  comparePanLocked?: boolean;
}

const FOCUS_PADDING = 16;
const PRIORITY_BUBBLE_MIN_WIDTH = 180;
const PRIORITY_BUBBLE_MAX_WIDTH = 340;
const PRIORITY_BUBBLE_HANDLE_WIDTH = 44;
const PRIORITY_BUBBLE_HANDLE_HEIGHT = 6;
const PRIORITY_BUBBLE_PADDING_X = 14;
const PRIORITY_BUBBLE_PADDING_TOP = 22;
const PRIORITY_BUBBLE_PADDING_BOTTOM = 14;
const PRIORITY_BUBBLE_LINE_HEIGHT = 16;
const PRIORITY_BUBBLE_CHAR_LIMIT = 42;

function isStudyBoxPrimitive(primitive: Primitive) {
  return primitive.kind === 'rectangle';
}

function isMapSelectablePrimitive(primitive: Primitive) {
  return primitive.kind !== 'group';
}

function getPriorityNote(primitive: Primitive | null) {
  return primitive?.notes?.find((note) => note.isPriority && note.content.trim()) ?? null;
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
  compareZoomLocked = false,
  comparePanLocked = false,
}: HotspotLayerProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewportSize, setViewportSize] = useState({ w: 1, h: 1 });
  const [viewTick, setViewTick] = useState(0);
  const [viewportAnimating, setViewportAnimating] = useState(false);
  const [draftPointer, setDraftPointer] = useState<Point | null>(null);
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
    handleOffsetX: number;
    handleOffsetY: number;
  } | null>(null);
  const [priorityBubbleDraftAnchors, setPriorityBubbleDraftAnchors] = useState<
    Record<string, Point>
  >({});

  const selectedPrimitiveId = useEditorStore((s) => s.selectedPrimitiveId);
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
  const activePageIndex = useMapStore(
    (s) => s.maps.find((m) => m.id === s.activeMapId)?.pageIndex ?? 0
  );

  const primitivesById = useMemo(
    () => new Map(workspace.primitives.map((p) => [p.id, p])),
    [workspace.primitives]
  );
  const selectedPrimitive = selectedPrimitiveId
    ? primitivesById.get(selectedPrimitiveId) ?? null
    : null;

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
        if (isGroupedMember) return filters.group;
        return filters.studyBox;
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
    if (compareOnly) return [];
    return workspace.primitives
      .map((primitive) => {
        const priorityNote = getPriorityNote(primitive);
        if (!priorityNote || primitive.showPriorityNote !== true) return null;
        const isSelected = selectedPrimitiveId === primitive.id;
        const shouldShow =
          isSelected || (!compareOnly && visibleOverlayFilters.priorityNote);
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
        const anchor =
          priorityBubbleDraftAnchors[primitive.id] ??
          primitive.priorityNoteAnchor ??
          fallbackAnchor ??
          {
            x: clamp(bounds.x + bounds.w / 2, 0.02, 0.98),
            y: clamp(bounds.y - 0.06, 0.02, 0.98),
          };
        const anchorPoint = normalizedPointToViewerElementPoint(viewer, anchor, dims);
        if (!anchorPoint) return null;
        const x = clamp(
          anchorPoint.x - layout.width / 2,
          8,
          Math.max(8, viewportSize.w - layout.width - 8)
        );
        const y = clamp(
          anchorPoint.y,
          8,
          Math.max(8, viewportSize.h - layout.height - 8)
        );
        return {
          primitiveId: primitive.id,
          anchor,
          x,
          y,
          ...layout,
        };
      })
      .filter((bubble): bubble is NonNullable<typeof bubble> => bubble !== null);
  }, [
    compareOnly,
    workspace.primitives,
    selectedPrimitiveId,
    visibleOverlayFilters.priorityNote,
    priorityBubbleDraftAnchors,
    primitivesById,
    viewer,
    dims,
    viewportSize.w,
    viewportSize.h,
    viewTick,
    compareOnly,
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
        setSelectedPrimitiveId(id);
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
    setSelectedPrimitiveId,
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
          setSelectedPrimitiveId(id);
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
      if (
        overlaySelectionMode &&
        primitive.id !== overlayNeighborTargetId
      ) {
        if (editorMode === 'groupCollect') {
          if (!isStudyBoxPrimitive(primitive)) return;
          if (groupCollectTargetId) {
            addGroupMember(groupCollectTargetId, makeMemberKey(primitive.id));
          } else {
            addDraftGroupMember(makeMemberKey(primitive.id));
          }
        } else if (editorMode === 'overlayNeighborPick') {
          if (overlayNeighborTargetId && overlayNeighborTargetPageIndex !== null) {
            void (async () => {
              await addPrimitiveBacklink(
                overlayNeighborTargetPageIndex,
                overlayNeighborTargetId,
                activePageIndex,
                primitive.id
              );
              await setActivePage(overlayNeighborTargetPageIndex);
              setSelectedPrimitiveId(overlayNeighborTargetId);
              setEditorMode('none');
            })();
          } else {
            addNeighborMember(makeMemberKey(primitive.id));
          }
        }
        return;
      }
      setSelectedPrimitiveId(primitive.id);
    },
    [
      overlaySelectionMode,
      overlayNeighborTargetId,
      overlayNeighborTargetPageIndex,
      groupCollectTargetId,
      activePageIndex,
      editorMode,
      addDraftGroupMember,
      addGroupMember,
      addNeighborMember,
      addPrimitiveBacklink,
      setActivePage,
      setSelectedPrimitiveId,
      setEditorMode,
    ]
  );

  const beginInteractiveDrag = useCallback(
    (event: React.PointerEvent<SVGElement>, activate: () => void) => {
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
    [editorMode, overlaySelectionMode, effectivePanLocked, spacePanActive, onMapDragActiveChange]
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
      if (!drag.moved && !compareOnly) drag.activate();
    },
    [onMapDragActiveChange, compareOnly]
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
    (event: React.PointerEvent<SVGRectElement>, primitiveId: string) => {
      if (compareOnly) return;
      event.preventDefault();
      event.stopPropagation();
      const bubble = priorityBubbles.find((entry) => entry.primitiveId === primitiveId);
      if (!bubble) return;
      const svg = svgRef.current;
      if (!svg) return;
      const bounds = svg.getBoundingClientRect();
      const pointerX = event.clientX - bounds.left;
      const pointerY = event.clientY - bounds.top;
      const handleCenterX = bubble.x + bubble.width / 2;
      const handleCenterY = bubble.y + 8 + PRIORITY_BUBBLE_HANDLE_HEIGHT / 2;
      priorityBubbleDragRef.current = {
        pointerId: event.pointerId,
        primitiveId,
        handleOffsetX: pointerX - handleCenterX,
        handleOffsetY: pointerY - handleCenterY,
      };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    },
    [compareOnly, priorityBubbles]
  );

  const continuePriorityBubbleDrag = useCallback(
    (event: React.PointerEvent<SVGRectElement>) => {
      const drag = priorityBubbleDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const svg = svgRef.current;
      if (!svg) return;
      const bounds = svg.getBoundingClientRect();
      const pointerX = event.clientX - bounds.left;
      const pointerY = event.clientY - bounds.top;
      const topCenterX = pointerX - drag.handleOffsetX;
      const topY = pointerY - drag.handleOffsetY - 8 - PRIORITY_BUBBLE_HANDLE_HEIGHT / 2;
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
    (event: React.PointerEvent<SVGRectElement>) => {
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
        updatePrimitive(drag.primitiveId, {
          priorityNoteAnchor: nextAnchor,
          priorityNoteOffset: undefined,
        });
      }
      setPriorityBubbleDraftAnchors((current) => {
        const next = { ...current };
        delete next[drag.primitiveId];
        return next;
      });
      priorityBubbleDragRef.current = null;
    },
    [priorityBubbleDraftAnchors, updatePrimitive]
  );

  const cancelPriorityBubbleDrag = useCallback(
    (event: React.PointerEvent<SVGRectElement>) => {
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
    },
    []
  );

  // re-render markers when viewport changes
  void viewTick;

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
            (compareOnly ? compareShowAllOverlays : false) ||
            (!compareOnly && primitiveMatchesFilter(primitive, visibleOverlayFilters)) ||
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
            !simplifyOverlay && activeFocusId === primitive.id ? (
              <circle
                cx={boundsRect.x + boundsRect.width - 4}
                cy={boundsRect.y + 4}
                r={6}
                fill="#dc2626"
                stroke="#ffffff"
                strokeWidth={2}
                pointerEvents="none"
              />
            ) : null;

          const interactiveStyle = {
            pointerEvents:
              compareOnly ||
              spacePanActive ||
              (editorMode !== 'none' && !overlaySelectionMode) ||
              !isMapSelectablePrimitive(primitive)
                ? ('none' as const)
                : ('all' as const),
            cursor: mapDragActive ? 'grabbing' : 'pointer',
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
                  fill="#dc2626"
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
                      width={Math.min(
                        Math.max(primitive.name.length * 7 + 14, 60),
                        Math.max(boundsRect.width, 80)
                      )}
                      height={16}
                      rx={3}
                      fill={primitive.color}
                      opacity={0.9}
                    />
                    <text
                      x={boundsRect.x + 7}
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

      {priorityBubbles.map((priorityBubble) => (
          <g key={`priority-bubble-${priorityBubble.primitiveId}`}>
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
              pointerEvents="none"
            />
            <rect
              x={priorityBubble.x + (priorityBubble.width - PRIORITY_BUBBLE_HANDLE_WIDTH) / 2}
              y={priorityBubble.y + 8}
              width={PRIORITY_BUBBLE_HANDLE_WIDTH}
              height={PRIORITY_BUBBLE_HANDLE_HEIGHT}
              rx={PRIORITY_BUBBLE_HANDLE_HEIGHT / 2}
              fill="#f59e0b"
              opacity={0.45}
              style={{ cursor: compareOnly ? 'default' : 'grab' }}
              onPointerDown={(event) =>
                beginPriorityBubbleDrag(
                  event,
                  priorityBubble.primitiveId
                )
              }
              onPointerMove={continuePriorityBubbleDrag}
              onPointerUp={endPriorityBubbleDrag}
              onPointerCancel={cancelPriorityBubbleDrag}
            />
            <text
              x={priorityBubble.x + PRIORITY_BUBBLE_PADDING_X}
              y={priorityBubble.y + PRIORITY_BUBBLE_PADDING_TOP}
              fill="#7c2d12"
              fontSize={12}
              fontWeight={600}
              style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
              pointerEvents="none"
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
