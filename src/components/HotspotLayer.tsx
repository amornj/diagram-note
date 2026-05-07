import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';
import {
  bboxToViewerElementRect,
  fitBBox,
  normalizedPointToViewerElementPoint,
  viewerElementPointToNormalizedPoint,
  type SourceDims,
} from '../lib/coords';
import { useEditorStore } from '../lib/store';
import {
  bboxFromPoints,
  getGroupMemberKeys,
  getPrimitiveBounds,
  makeMemberKey,
  parseMemberKey,
} from '../lib/workspace';
import type { Point, Primitive } from '../types';
import { useMapStore } from '../lib/mapStore';

interface HotspotLayerProps {
  viewer: OpenSeadragon.Viewer;
  dims: SourceDims;
  mapDragActive: boolean;
  onMapDragActiveChange: (active: boolean) => void;
}

const FOCUS_PADDING = 16;

export default function HotspotLayer({
  viewer,
  dims,
  mapDragActive,
  onMapDragActiveChange,
}: HotspotLayerProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewportSize, setViewportSize] = useState({ w: 1, h: 1 });
  const [viewTick, setViewTick] = useState(0);
  const [draftPointer, setDraftPointer] = useState<Point | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    activate: () => void;
  } | null>(null);

  const selectedPrimitiveId = useEditorStore((s) => s.selectedPrimitiveId);
  const hoveredPrimitiveId = useEditorStore((s) => s.hoveredPrimitiveId);
  const selectedOccurrenceIndex = useEditorStore((s) => s.selectedOccurrenceIndex);
  const workspace = useEditorStore((s) => s.workspace);
  const editorMode = useEditorStore((s) => s.editorMode);
  const showAllPrimitivesVisible = useEditorStore((s) => s.showAllPrimitivesVisible);
  const draftOverlayColor = useEditorStore((s) => s.draftOverlayColor);
  const draftPolygonPoints = useEditorStore((s) => s.draftPolygonPoints);
  const draftRectangleStart = useEditorStore((s) => s.draftRectangleStart);
  const setSelectedPrimitiveId = useEditorStore((s) => s.setSelectedPrimitiveId);
  const setHoveredPrimitiveId = useEditorStore((s) => s.setHoveredPrimitiveId);
  const addDraftPolygonPoint = useEditorStore((s) => s.addDraftPolygonPoint);
  const clearDraftPolygon = useEditorStore((s) => s.clearDraftPolygon);
  const setDraftRectangleStart = useEditorStore((s) => s.setDraftRectangleStart);
  const addPrimitive = useEditorStore((s) => s.addPrimitive);
  const setEditorMode = useEditorStore((s) => s.setEditorMode);
  const zoomLocked = useEditorStore((s) => s.zoomLocked);
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

  const primitiveShapes = useMemo(() => {
    return workspace.primitives
      .map((primitive) => {
        const bounds = getPrimitiveBounds(primitive, primitivesById);
        if (!bounds) return null;
        return { primitive, bounds };
      })
      .filter(
        (entry): entry is { primitive: Primitive; bounds: import('../types').BBox } =>
          entry !== null
      );
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
      frame = window.requestAnimationFrame(update);
    };

    viewer.addHandler('animation', schedule);
    viewer.addHandler('update-viewport', schedule);
    viewer.addHandler('open', schedule);
    viewer.addHandler('resize', schedule);
    schedule();

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      viewer.removeHandler('animation', schedule);
      viewer.removeHandler('update-viewport', schedule);
      viewer.removeHandler('open', schedule);
      viewer.removeHandler('resize', schedule);
    };
  }, [viewer]);

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
    if (!selectedPrimitive) return;
    if (selectedPrimitive.kind === 'group' && selectedGroupTargets.length) {
      const target =
        selectedGroupTargets[
          Math.min(selectedOccurrenceIndex, selectedGroupTargets.length - 1)
        ];
      if (target?.bbox) {
        fitBBox(viewer, target.bbox, dims, {
          locked: zoomLocked,
          padding: FOCUS_PADDING,
        });
        return;
      }
    }
    const bounds = getPrimitiveBounds(selectedPrimitive, primitivesById);
    if (bounds) {
      fitBBox(viewer, bounds, dims, {
        locked: zoomLocked,
        padding: FOCUS_PADDING,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPrimitiveId, selectedOccurrenceIndex, selectionGeomKey, viewer, zoomLocked, dims.width, dims.height]);

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
      if (
        overlaySelectionMode &&
        primitive.id !== overlayNeighborTargetId
      ) {
        if (editorMode === 'groupCollect') {
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
    [editorMode, overlaySelectionMode, spacePanActive, onMapDragActiveChange]
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
      viewer.viewport.panBy(delta, true);
      viewer.viewport.applyConstraints();
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
    },
    [viewer]
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

  // re-render markers when viewport changes
  void viewTick;

  if (editorMode === 'textSelect') return null;

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
            showAllPrimitivesVisible ||
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
            showGroupNumbers && groupEntry ? (
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
            activeFocusId === primitive.id ? (
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
              spacePanActive ||
              (editorMode !== 'none' && !overlaySelectionMode) ||
              (primitive.kind === 'group' && isSelected)
                ? ('none' as const)
                : ('auto' as const),
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
                {isVisible && primitive.showLabel === true && (
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
                {isVisible && primitive.showLabel === true && (
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
                <rect
                  x={boundsRect.x}
                  y={boundsRect.y}
                  width={boundsRect.width}
                  height={boundsRect.height}
                  rx={12}
                  fill="transparent"
                  stroke="transparent"
                  strokeWidth={18}
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
                {focusDot}
                {isVisible && primitive.showLabel === true && (
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
              {focusDot ?? (isSelected && primitive.kind === 'rectangle' ? (
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
              {isVisible &&
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

      {editorMode !== 'none' &&
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
