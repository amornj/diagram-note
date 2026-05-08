import { useCallback, useEffect, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';
import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  Eye,
  Home,
  Lock,
  Map,
  Pin,
  Minus,
  PenTool,
  Plus,
  Search,
  Square,
  Shapes,
  Unlock,
} from 'lucide-react';
import HotspotLayer from './HotspotLayer';
import SearchBox from './SearchBox';
import DrawTools from './DrawTools';
import PagePicker from './PagePicker';
import TextLayer from './TextLayer';
import { useEditorStore } from '../lib/store';
import { useMapStore } from '../lib/mapStore';
import { fitBBox, type SourceDims } from '../lib/coords';
import * as idb from '../lib/idb';
import type { BBox, MapWorkspace } from '../types';

type DraggablePanelKey = 'search' | 'map' | 'studybox' | 'group' | 'polyline';

type PanelOffset = { x: number; y: number };

const DEFAULT_PANEL_OFFSET: PanelOffset = { x: 0, y: 0 };

interface EditorProps {
  rasterUrl: string;
  dims: SourceDims;
  pageIndex: number;
  pageCount: number;
  leftInset?: number;
  compareOnly?: boolean;
  title?: string;
  sourceType?: 'pdf' | 'image';
  onComparePageChange?: (pageIndex: number) => void;
  workspaceOverride?: MapWorkspace;
  splitMode?: boolean;
  onToggleSplitMode?: () => void;
  mapOptions?: Array<{ id: string; name: string }>;
  selectedMapId?: string | null;
  onSelectMap?: (mapId: string) => void;
  compareShowAllOverlays?: boolean;
  onToggleCompareOverlays?: () => void;
  compareFocusTarget?: { bbox: BBox; nonce: number } | null;
  onActivatePane?: () => void;
  isFocusedPane?: boolean;
}

export default function Editor({
  rasterUrl,
  dims,
  pageIndex,
  pageCount,
  leftInset = 0,
  compareOnly = false,
  title,
  onComparePageChange,
  workspaceOverride,
  splitMode = false,
  onToggleSplitMode,
  mapOptions,
  selectedMapId,
  onSelectMap,
  compareShowAllOverlays = false,
  onToggleCompareOverlays,
  compareFocusTarget,
  onActivatePane,
  isFocusedPane = false,
}: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null);
  const [viewer, setViewer] = useState<OpenSeadragon.Viewer | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [mapDragActive, setMapDragActive] = useState(false);
  const [spaceDragActive, setSpaceDragActive] = useState(false);
  const [showQuickSearch, setShowQuickSearch] = useState(false);
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [floatingTool, setFloatingTool] = useState<
    null | 'studybox' | 'group' | 'polyline'
  >(null);
  const [groupBuilderFocusSignal, setGroupBuilderFocusSignal] = useState(0);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [panelOffsets, setPanelOffsets] = useState<Record<DraggablePanelKey, PanelOffset>>({
    search: DEFAULT_PANEL_OFFSET,
    map: DEFAULT_PANEL_OFFSET,
    studybox: DEFAULT_PANEL_OFFSET,
    group: DEFAULT_PANEL_OFFSET,
    polyline: DEFAULT_PANEL_OFFSET,
  });
  const spaceHeldRef = useRef(false);
  const panelDragRef = useRef<{
    key: DraggablePanelKey;
    pointerId: number;
    startX: number;
    startY: number;
    startOffset: PanelOffset;
  } | null>(null);

  const setSelectedPrimitiveId = useEditorStore((s) => s.setSelectedPrimitiveId);
  const zoomTarget = useEditorStore((s) => s.zoomTarget);
  const setZoomTarget = useEditorStore((s) => s.setZoomTarget);
  const zoomLocked = useEditorStore((s) => s.zoomLocked);
  const toggleZoomLock = useEditorStore((s) => s.toggleZoomLock);
  const panLocked = useEditorStore((s) => s.panLocked);
  const togglePanLock = useEditorStore((s) => s.togglePanLock);
  const toggleLeftSidebar = useEditorStore((s) => s.toggleLeftSidebar);
  const setLeftSidebarCollapsed = useEditorStore((s) => s.setLeftSidebarCollapsed);
  const toggleRightPane = useEditorStore((s) => s.toggleRightPane);
  const cycleSelection = useEditorStore((s) => s.cycleSelection);
  const setSpacePanActive = useEditorStore((s) => s.setSpacePanActive);
  const editorMode = useEditorStore((s) => s.editorMode);
  const clearDraftGroup = useEditorStore((s) => s.clearDraftGroup);
  const clearDraftPolygon = useEditorStore((s) => s.clearDraftPolygon);
  const setEditorMode = useEditorStore((s) => s.setEditorMode);
  const showAllPrimitivesVisible = useEditorStore((s) => s.showAllPrimitivesVisible);
  const toggleShowAllPrimitivesVisible = useEditorStore(
    (s) => s.toggleShowAllPrimitivesVisible
  );
  const activeMapId = useMapStore((s) => s.activeMapId);
  const activeMap = useMapStore((s) => s.maps.find((m) => m.id === s.activeMapId) ?? null);

  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);

  // Load PDF blob when entering text-select mode (PDF sources only)
  useEffect(() => {
    if (compareOnly || editorMode !== 'textSelect') { setPdfBlob(null); return; }
    if (!activeMapId || activeMap?.sourceType !== 'pdf') return;
    idb.getPdfBlob(activeMapId).then((blob) => setPdfBlob(blob));
  }, [editorMode, activeMapId, activeMap?.sourceType]);

  // Enable/disable OSD mouse navigation based on mode; reset inline cursor.
  useEffect(() => {
    if (!viewer) return;
    const isText = editorMode === 'textSelect';
    viewer.setMouseNavEnabled(!isText);
    // In text mode the PDF.js text layer must receive pointer events directly.
    // Disable hit-testing on the entire OSD surface, not just the canvas.
    const viewerElement = containerRef.current;
    if (viewerElement) {
      viewerElement.style.pointerEvents = isText ? 'none' : '';
    }
    const canvas = viewer.canvas as HTMLElement | undefined;
    if (canvas) {
      canvas.style.cursor = isText ? 'text' : '';
    }
  }, [viewer, editorMode]);

  // Initialize viewer (rebuild whenever the raster URL changes — i.e. map switch)
  useEffect(() => {
    if (!containerRef.current) return;
    const viewer = OpenSeadragon({
      element: containerRef.current,
      tileSources: { type: 'image', url: rasterUrl },
      prefixUrl: '',
      mouseNavEnabled: true,
      showNavigationControl: false,
      minZoomLevel: 0.1,
      maxZoomLevel: 12,
      defaultZoomLevel: 0,
      visibilityRatio: 0.5,
      constrainDuringPan: true,
      crossOriginPolicy: 'Anonymous',
    });

    viewerRef.current = viewer;
    setViewer(viewer);

    viewer.addHandler('open', () => {
      setViewerReady(true);
      viewer.viewport.goHome();
    });

    viewer.addHandler('canvas-click', (event: OpenSeadragon.CanvasClickEvent) => {
      if (!event.quick) return;
      const target = event.originalTarget as HTMLElement | null;
      if (target && target.closest('[data-hotspot]')) return;
      setSelectedPrimitiveId(null);
    });

    return () => {
      viewer.destroy();
      viewerRef.current = null;
      setViewer(null);
      setViewerReady(false);
    };
  }, [rasterUrl, setSelectedPrimitiveId]);

  // Reset transient UI when map switches
  useEffect(() => {
    setShowQuickSearch(false);
    setShowMapPicker(false);
    setFloatingTool(null);
  }, [activeMapId]);

  useEffect(() => {
    if (!viewer || !zoomTarget || compareOnly) return;
    fitBBox(viewer, zoomTarget.bbox, dims, {
      immediate: zoomTarget.immediate ?? false,
      locked: zoomTarget.lockZoom ?? zoomLocked,
      frozen: panLocked,
      padding: zoomTarget.padding,
    });
    setZoomTarget(null);
  }, [viewer, zoomTarget, setZoomTarget, zoomLocked, panLocked, dims]);

  useEffect(() => {
    if (!viewer || !compareOnly || !compareFocusTarget) return;
    fitBBox(viewer, compareFocusTarget.bbox, dims, {
      immediate: false,
      locked: false,
      padding: 16,
    });
  }, [viewer, compareOnly, compareFocusTarget, dims]);

  const zoomIn = useCallback(() => {
    if (zoomLocked) return;
    viewer?.viewport.zoomBy(1.5);
  }, [viewer, zoomLocked]);
  const zoomOut = useCallback(() => {
    if (zoomLocked) return;
    viewer?.viewport.zoomBy(0.667);
  }, [viewer, zoomLocked]);
  const goHome = useCallback(() => viewer?.viewport.goHome(), [viewer]);
  const openSearch = useCallback(() => {
    setLeftSidebarCollapsed(true);
    setFloatingTool(null);
    setShowMapPicker(false);
    setShowQuickSearch(true);
    window.dispatchEvent(new Event('map-search-focus'));
  }, [setLeftSidebarCollapsed]);
  const toggleMapPicker = useCallback(() => {
    setShowQuickSearch(false);
    setFloatingTool(null);
    setShowMapPicker((value) => !value);
  }, []);
  const openStudyBoxTool = useCallback(() => {
    setLeftSidebarCollapsed(true);
    setShowQuickSearch(false);
    setFloatingTool('studybox');
    setSelectedPrimitiveId(null);
    setEditorMode('rectangle');
    window.dispatchEvent(new Event('map-search-clear'));
    containerRef.current?.focus({ preventScroll: true });
  }, [setEditorMode, setLeftSidebarCollapsed, setSelectedPrimitiveId]);
  const openGroupTool = useCallback(() => {
    setLeftSidebarCollapsed(true);
    setShowQuickSearch(false);
    setFloatingTool('group');
    setEditorMode('groupCollect');
    setSelectedPrimitiveId(null);
    window.dispatchEvent(new Event('map-search-clear'));
    setGroupBuilderFocusSignal((value) => value + 1);
  }, [setEditorMode, setLeftSidebarCollapsed, setSelectedPrimitiveId]);
  const openPolylineTool = useCallback(() => {
    setLeftSidebarCollapsed(true);
    setShowQuickSearch(false);
    setFloatingTool('polyline');
    setSelectedPrimitiveId(null);
    setEditorMode('polygon');
    window.dispatchEvent(new Event('map-search-clear'));
    containerRef.current?.focus({ preventScroll: true });
  }, [setEditorMode, setLeftSidebarCollapsed, setSelectedPrimitiveId]);

  const startPanelDrag = useCallback(
    (key: DraggablePanelKey, event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const startOffset = panelOffsets[key];
      panelDragRef.current = {
        key,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startOffset,
      };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    },
    [panelOffsets]
  );

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = panelDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      setPanelOffsets((current) => ({
        ...current,
        [drag.key]: {
          x: drag.startOffset.x + (event.clientX - drag.startX),
          y: drag.startOffset.y + (event.clientY - drag.startY),
        },
      }));
    };

    const clearDrag = (event: PointerEvent) => {
      const drag = panelDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      panelDragRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', clearDrag);
    window.addEventListener('pointercancel', clearDrag);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', clearDrag);
      window.removeEventListener('pointercancel', clearDrag);
    };
  }, []);

  const renderDraggablePanel = useCallback(
    (key: DraggablePanelKey, widthClass: string, children: React.ReactNode) => {
      const offset = panelOffsets[key];
      return (
        <div
          className={`absolute z-20 max-w-[calc(100vw-5rem)] -translate-x-1/2 ${widthClass}`}
          style={{
            left: `calc(${leftInset}px + (100% - ${leftInset}px) / 2 + ${offset.x}px)`,
            top: `${64 + offset.y}px`,
          }}
        >
          <div
            onPointerDown={(event) => startPanelDrag(key, event)}
            className="mb-2 flex cursor-grab justify-center pt-1 active:cursor-grabbing"
          >
            <div className="h-1.5 w-14 rounded-full bg-white/35 shadow-sm backdrop-blur transition hover:bg-white/55" />
          </div>
          <div className="relative">
            <div className="pointer-events-none absolute inset-x-0 -top-3 flex justify-center">
              <div className="h-1.5 w-14 rounded-full bg-white/15" />
            </div>
            {children}
          </div>
        </div>
      );
    },
    [leftInset, panelOffsets, startPanelDrag]
  );

  const handleWheelZoom = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!viewer) return;
      event.preventDefault();
      event.stopPropagation();
      if (zoomLocked) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const pixel = new OpenSeadragon.Point(
        event.clientX - bounds.left,
        event.clientY - bounds.top
      );
      const refPoint = viewer.viewport.pointFromPixel(pixel, true);
      const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2;
      viewer.viewport.zoomBy(factor, refPoint);
      viewer.viewport.applyConstraints();
    },
    [viewer, zoomLocked]
  );

  // Hotkeys
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !viewer) return;
    container.setAttribute('tabindex', '0');

    const updateZoomPercent = () => {
      const zoom = viewer.viewport.getZoom(true);
      setZoomPercent(Math.round(zoom * 100));
    };

    const handleCanvasDrag = () => setMapDragActive(true);
    const handleCanvasRelease = () => setMapDragActive(false);

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;

      if (compareOnly) {
        if (event.key === 'Escape') {
          setShowMapPicker(false);
        }
        if (!isFocusedPane) return;
        let handled = true;
        switch (event.key) {
          case 'm':
          case 'M':
            setShowMapPicker((value) => !value);
            break;
          case '1':
            if (isFocusedPane) toggleLeftSidebar();
            break;
          case '\\':
            onToggleCompareOverlays?.();
            break;
          case '9':
            toggleZoomLock();
            break;
          case 'p':
          case 'P':
            togglePanLock();
            break;
          case '+':
          case '=':
            if (!zoomLocked) viewer.viewport.zoomBy(1.3);
            break;
          case '-':
          case '_':
            if (!zoomLocked) viewer.viewport.zoomBy(0.77);
            break;
          case 'ArrowUp':
            if (!panLocked) viewer.viewport.panBy(new OpenSeadragon.Point(0, -0.08));
            break;
          case 'ArrowDown':
            if (!panLocked) viewer.viewport.panBy(new OpenSeadragon.Point(0, 0.08));
            break;
          case 'ArrowLeft':
            if (!panLocked) viewer.viewport.panBy(new OpenSeadragon.Point(-0.08, 0));
            break;
          case 'ArrowRight':
            if (!panLocked) viewer.viewport.panBy(new OpenSeadragon.Point(0.08, 0));
            break;
          case '0':
          case 'Home':
            viewer.viewport.goHome();
            break;
          default:
            handled = false;
        }
        if (handled) event.preventDefault();
        return;
      }

      if (event.key === ' ' && !editing && !panLocked) {
        event.preventDefault();
        spaceHeldRef.current = true;
        setSpacePanActive(true);
        return;
      }

      if (event.key === 'Escape') {
        setShowMapPicker(false);
        setShowQuickSearch(false);
        setFloatingTool(null);
        if (editorMode === 'textSelect') {
          event.preventDefault();
          setEditorMode('none');
          return;
        }
        if (editorMode === 'rectangle' || editorMode === 'polygon') {
          event.preventDefault();
          if (editorMode === 'polygon') clearDraftPolygon();
          setEditorMode('none');
          return;
        }
        if (editorMode === 'groupCollect') {
          event.preventDefault();
          clearDraftGroup();
          setEditorMode('none');
          return;
        }
      }

      if (editing) return;

      const panSpeed = 0.08;
      let handled = true;
      switch (event.key) {
        case 'm':
        case 'M':
          toggleMapPicker();
          break;
        case 't':
        case 'T':
          setEditorMode(editorMode === 'textSelect' ? 'none' : 'textSelect');
          break;
        case '+':
        case '=':
          if (!zoomLocked) viewer.viewport.zoomBy(1.3);
          break;
        case '-':
        case '_':
          if (!zoomLocked) viewer.viewport.zoomBy(0.77);
          break;
        case '1':
          toggleLeftSidebar();
          break;
        case '2':
          toggleRightPane();
          break;
        case '3':
          handled = cycleSelection(-1);
          break;
        case '4':
          handled = cycleSelection(1);
          break;
        case '5':
          openSearch();
          break;
        case '6':
          openStudyBoxTool();
          break;
        case '7':
          openGroupTool();
          break;
        case '8':
          openPolylineTool();
          break;
        case '9':
          toggleZoomLock();
          break;
        case 'p':
        case 'P':
          togglePanLock();
          break;
        case '\\':
          toggleShowAllPrimitivesVisible();
          break;
        case 'ArrowUp':
          if (!panLocked) viewer.viewport.panBy(new OpenSeadragon.Point(0, -panSpeed));
          break;
        case 'ArrowDown':
          if (!panLocked) viewer.viewport.panBy(new OpenSeadragon.Point(0, panSpeed));
          break;
        case 'ArrowLeft':
          if (!panLocked) viewer.viewport.panBy(new OpenSeadragon.Point(-panSpeed, 0));
          break;
        case 'ArrowRight':
          if (!panLocked) viewer.viewport.panBy(new OpenSeadragon.Point(panSpeed, 0));
          break;
        case '0':
        case 'Home':
          viewer.viewport.goHome();
          break;
        default:
          handled = false;
      }
      if (handled) event.preventDefault();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ') {
        spaceHeldRef.current = false;
        setSpacePanActive(false);
      }
    };

    const onClick = () => container?.focus({ preventScroll: true });
    const onPointerDown = () => {
      if (!spaceHeldRef.current) return;
      setSpaceDragActive(true);
    };
    const onPointerUp = () => {
      if (!spaceHeldRef.current) return;
      setSpaceDragActive(false);
    };

    viewer.addHandler('animation', updateZoomPercent);
    viewer.addHandler('open', updateZoomPercent);
    viewer.addHandler('zoom', updateZoomPercent);
    viewer.addHandler('canvas-drag', handleCanvasDrag);
    viewer.addHandler('canvas-release', handleCanvasRelease);
    viewer.addHandler('canvas-drag-end', handleCanvasRelease);
    updateZoomPercent();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    container.addEventListener('click', onClick);
    container.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      spaceHeldRef.current = false;
      setSpacePanActive(false);
      setMapDragActive(false);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      container.removeEventListener('click', onClick);
      container.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      viewer.removeHandler('animation', updateZoomPercent);
      viewer.removeHandler('open', updateZoomPercent);
      viewer.removeHandler('zoom', updateZoomPercent);
      viewer.removeHandler('canvas-drag', handleCanvasDrag);
      viewer.removeHandler('canvas-release', handleCanvasRelease);
      viewer.removeHandler('canvas-drag-end', handleCanvasRelease);
    };
  }, [
    viewer,
    setSelectedPrimitiveId,
    toggleLeftSidebar,
    setLeftSidebarCollapsed,
    toggleRightPane,
    cycleSelection,
    toggleZoomLock,
    togglePanLock,
    setSpacePanActive,
    editorMode,
    clearDraftGroup,
    clearDraftPolygon,
    openStudyBoxTool,
    openGroupTool,
    openPolylineTool,
    openSearch,
    toggleMapPicker,
    setEditorMode,
    toggleShowAllPrimitivesVisible,
    compareOnly,
    onToggleCompareOverlays,
    isFocusedPane,
    panLocked,
  ]);

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-gray-900"
      onWheel={handleWheelZoom}
      onPointerDown={() => onActivatePane?.()}
      style={{
        cursor:
          editorMode === 'textSelect'
            ? 'text'
            : editorMode === 'none' ||
              editorMode === 'groupCollect' ||
              editorMode === 'overlayNeighborPick'
            ? panLocked
              ? 'default'
              : mapDragActive || spaceDragActive
              ? 'grabbing'
              : 'grab'
            : 'crosshair',
        userSelect: editorMode === 'textSelect' ? 'text' : 'none',
        WebkitUserSelect: editorMode === 'textSelect' ? 'text' : 'none',
      }}
    >
      <div ref={containerRef} className="absolute inset-0" />

      {!viewerReady && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[radial-gradient(circle_at_top,#1e293b,#020617)] text-white">
          <div className="rounded-2xl border border-white/10 bg-white/5 px-6 py-5 text-center backdrop-blur">
            <div className="mx-auto h-10 w-10 animate-pulse rounded-full border border-white/20 bg-white/10" />
            <div className="mt-4 text-sm font-medium tracking-wide text-white/90">
              Loading map
            </div>
          </div>
        </div>
      )}

      {viewerReady && viewer && (
        <HotspotLayer
          viewer={viewer}
          dims={dims}
          mapDragActive={mapDragActive || spaceDragActive}
          onMapDragActiveChange={setMapDragActive}
          compareOnly={compareOnly}
          workspaceOverride={workspaceOverride}
          compareShowAllOverlays={compareShowAllOverlays}
        />
      )}

      {viewerReady && viewer && !compareOnly && editorMode === 'textSelect' && pdfBlob && (
        <TextLayer
          pdfBlob={pdfBlob}
          pageIndex={pageIndex}
          viewer={viewer}
        />
      )}

      <div
        className="absolute top-4 z-10 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-white/10 bg-black/45 px-2 py-2 shadow-lg backdrop-blur transition-[left] duration-200"
        style={{ left: `calc(${leftInset}px + (100% - ${leftInset}px) / 2)` }}
      >
        {compareOnly && title && (
          <div className="mr-2 rounded-lg bg-white/10 px-2 py-1 text-xs font-semibold text-white/90">
            {title}
          </div>
        )}
        <button
          onClick={zoomIn}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/90 text-gray-700 shadow transition hover:bg-white"
          title="Zoom in (+)"
        >
          <Plus size={17} />
        </button>
        <button
          onClick={zoomOut}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/90 text-gray-700 shadow transition hover:bg-white"
          title="Zoom out (-)"
        >
          <Minus size={17} />
        </button>
        <button
          onClick={toggleZoomLock}
          className={`flex h-8 w-8 items-center justify-center rounded-lg shadow transition ${
            zoomLocked
              ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
              : 'bg-white/90 text-gray-700 hover:bg-white'
          }`}
          title={
            zoomLocked
              ? `Zoom locked at ${zoomPercent}%`
              : 'Lock zoom (apply to focus & search)'
          }
        >
          {zoomLocked ? <Lock size={15} /> : <Unlock size={15} />}
        </button>
        {compareOnly && (
          <button
            onClick={togglePanLock}
            className={`flex h-8 w-8 items-center justify-center rounded-lg shadow transition ${
              panLocked
                ? 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                : 'bg-white/90 text-gray-700 hover:bg-white'
            }`}
            title={panLocked ? 'Pinned viewport (P)' : 'Pin viewport (P)'}
          >
            <Pin size={15} />
          </button>
        )}
        {!compareOnly && (
          <button
            onClick={togglePanLock}
            className={`flex h-8 w-8 items-center justify-center rounded-lg shadow transition ${
              panLocked
                ? 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                : 'bg-white/90 text-gray-700 hover:bg-white'
            }`}
            title={panLocked ? 'Pin focus movement off (P)' : 'Pin viewport while focusing (P)'}
          >
            <Pin size={15} />
          </button>
        )}
        <button
          onClick={goHome}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/90 text-gray-700 shadow transition hover:bg-white"
          title="Reset view (0)"
        >
          <Home size={16} />
        </button>
        {!compareOnly && activeMap?.sourceType === 'pdf' && (
          <button
            onClick={() => setEditorMode(editorMode === 'textSelect' ? 'none' : 'textSelect')}
            className={`flex h-8 w-8 items-center justify-center rounded-lg shadow transition ${
              editorMode === 'textSelect'
                ? 'bg-sky-500 text-white hover:bg-sky-600'
                : 'bg-white/90 text-gray-700 hover:bg-white'
            }`}
            title={editorMode === 'textSelect' ? 'Exit text mode (T or Esc)' : 'Select text (T)'}
          >
            <span className="text-[13px] font-bold leading-none">T</span>
          </button>
        )}
        {!compareOnly && (
          <button
          onClick={openSearch}
          className={`flex h-8 w-8 items-center justify-center rounded-lg shadow transition ${
            showQuickSearch
              ? 'bg-sky-500 text-white hover:bg-sky-600'
              : 'bg-white/90 text-gray-700 hover:bg-white'
          }`}
          title="Search (5)"
        >
          <Search size={15} />
          </button>
        )}
        {!compareOnly && (
          <button
          onClick={openStudyBoxTool}
          className={`flex h-8 w-8 items-center justify-center rounded-lg shadow transition ${
            floatingTool === 'studybox' || editorMode === 'rectangle'
              ? 'bg-sky-500 text-white hover:bg-sky-600'
              : 'bg-white/90 text-gray-700 hover:bg-white'
          }`}
          title="Study box (6)"
        >
          <Square size={15} />
          </button>
        )}
        {!compareOnly && (
          <button
          onClick={openGroupTool}
          className={`flex h-8 w-8 items-center justify-center rounded-lg shadow transition ${
            floatingTool === 'group'
              ? 'bg-sky-500 text-white hover:bg-sky-600'
              : 'bg-white/90 text-gray-700 hover:bg-white'
          }`}
          title="Group (7)"
        >
          <Shapes size={15} />
          </button>
        )}
        {!compareOnly && (
          <button
          onClick={openPolylineTool}
          className={`flex h-8 w-8 items-center justify-center rounded-lg shadow transition ${
            floatingTool === 'polyline' || editorMode === 'polygon'
              ? 'bg-sky-500 text-white hover:bg-sky-600'
              : 'bg-white/90 text-gray-700 hover:bg-white'
          }`}
          title="Polyline (8)"
        >
          <PenTool size={15} />
          </button>
        )}
        {!compareOnly && (
          <button
            onClick={toggleMapPicker}
            className={`flex h-8 w-8 items-center justify-center rounded-lg shadow transition ${
              showMapPicker
                ? 'bg-sky-500 text-white hover:bg-sky-600'
                : 'bg-white/90 text-gray-700 hover:bg-white'
            }`}
            title="Maps (M)"
          >
            <Map size={15} />
          </button>
        )}
        {!compareOnly && (
          <button
            onClick={onToggleSplitMode}
            className={`flex h-8 w-8 items-center justify-center rounded-lg shadow transition ${
              splitMode
                ? 'bg-sky-500 text-white hover:bg-sky-600'
                : 'bg-white/90 text-gray-700 hover:bg-white'
            }`}
            title={splitMode ? 'Exit split compare' : 'Split compare'}
          >
            <Columns2 size={15} />
          </button>
        )}
        {!compareOnly && (
          <button
            onClick={toggleShowAllPrimitivesVisible}
            className={`flex h-8 w-8 items-center justify-center rounded-lg shadow transition ${
            showAllPrimitivesVisible
              ? 'bg-sky-500 text-white hover:bg-sky-600'
              : 'bg-white/90 text-gray-700 hover:bg-white'
          }`}
          title={showAllPrimitivesVisible ? 'Hide all overlays (\\)' : 'Show all overlays (\\)'}
        >
          <Eye size={15} />
          </button>
        )}
        {compareOnly && (
          <>
            <button
              onClick={toggleMapPicker}
              className={`flex h-8 w-8 items-center justify-center rounded-lg shadow transition ${
                showMapPicker
                  ? 'bg-sky-500 text-white hover:bg-sky-600'
                  : 'bg-white/90 text-gray-700 hover:bg-white'
              }`}
              title="Maps (M)"
            >
              <Map size={15} />
            </button>
            <button
              onClick={onToggleCompareOverlays}
              className={`flex h-8 w-8 items-center justify-center rounded-lg shadow transition ${
                compareShowAllOverlays
                  ? 'bg-sky-500 text-white hover:bg-sky-600'
                  : 'bg-white/90 text-gray-700 hover:bg-white'
              }`}
              title={compareShowAllOverlays ? 'Hide overlays (\\)' : 'Show overlays (\\)'}
            >
              <Eye size={15} />
            </button>
          </>
        )}
      </div>

      {showMapPicker && (
        renderDraggablePanel(
          'map',
          'w-80',
          <div className="rounded-2xl border border-gray-200 bg-white p-2 shadow-lg">
            <div className="max-h-80 overflow-y-auto">
              {(mapOptions ?? []).map((map) => (
                <button
                  key={map.id}
                  onClick={() => {
                    onSelectMap?.(map.id);
                    setShowMapPicker(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition ${
                    selectedMapId === map.id ? 'bg-sky-50 text-sky-700' : 'hover:bg-gray-50'
                  }`}
                >
                  <span className="truncate">{map.name}</span>
                  {selectedMapId === map.id && (
                    <span className="text-[11px] font-semibold">active</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )
      )}

      {!compareOnly && showQuickSearch && (
        renderDraggablePanel('search', 'w-80', 
          <SearchBox
            floating
            autoFocus
            onRequestClose={() => setShowQuickSearch(false)}
          />
        )
      )}

      {!compareOnly && floatingTool === 'group' && (
        renderDraggablePanel('group', 'w-80',
          <DrawTools
            mode="group"
            groupBuilderFocusSignal={groupBuilderFocusSignal}
            onRequestClose={() => setFloatingTool(null)}
          />
        )
      )}

      {!compareOnly && floatingTool === 'studybox' && (
        renderDraggablePanel('studybox', 'w-fit',
          <DrawTools
            mode="studybox"
            onRequestClose={() => setFloatingTool(null)}
          />
        )
      )}

      {!compareOnly && floatingTool === 'polyline' && (
        renderDraggablePanel('polyline', 'w-fit',
          <DrawTools
            mode="polyline"
            onRequestClose={() => setFloatingTool(null)}
          />
        )
      )}

      <div
        className="absolute bottom-4 z-10 flex -translate-x-1/2 items-center gap-3"
        style={{ left: `calc(${leftInset}px + (100% - ${leftInset}px) / 2)` }}
      >
        <div className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-[11px] text-white/70 backdrop-blur pointer-events-none">
          {compareOnly
            ? 'M maps · 9 lock · P pin · \\ overlays · + zoom in · - zoom out · 0 home · drag pan'
            : '1 left · 2 right · 3 prev · 4 next · 5 search · 6 study box · 7 group · 8 polyline · 9 lock · P pin · 0 home · T text · M maps · B split · \\ overlays · ? help'}
        </div>
        {compareOnly && onComparePageChange && pageCount > 1 ? (
          <div className="flex items-center gap-1 rounded-full border border-white/10 bg-black/60 px-2 py-1 text-xs font-medium text-white/90 backdrop-blur">
            <button
              onClick={() => onComparePageChange(pageIndex - 1)}
              disabled={pageIndex <= 0}
              className="rounded-full p-1 transition hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent"
              aria-label="Previous page"
            >
              <ChevronLeft size={12} />
            </button>
            <span className="px-2 tabular-nums">
              Page {pageIndex + 1} / {pageCount}
            </span>
            <button
              onClick={() => onComparePageChange(pageIndex + 1)}
              disabled={pageIndex >= pageCount - 1}
              className="rounded-full p-1 transition hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent"
              aria-label="Next page"
            >
              <ChevronRight size={12} />
            </button>
          </div>
        ) : (
          pageCount > 1 && <PagePicker pageIndex={pageIndex} pageCount={pageCount} inline />
        )}
      </div>
    </div>
  );
}
