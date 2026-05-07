import { useCallback, useEffect, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Home,
  Lock,
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
import type { MapWorkspace } from '../types';

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
}: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null);
  const [viewer, setViewer] = useState<OpenSeadragon.Viewer | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [mapDragActive, setMapDragActive] = useState(false);
  const [spaceDragActive, setSpaceDragActive] = useState(false);
  const [showQuickSearch, setShowQuickSearch] = useState(false);
  const [floatingTool, setFloatingTool] = useState<
    null | 'studybox' | 'group' | 'polyline'
  >(null);
  const [groupBuilderFocusSignal, setGroupBuilderFocusSignal] = useState(0);
  const [zoomPercent, setZoomPercent] = useState(100);
  const spaceHeldRef = useRef(false);

  const setSelectedPrimitiveId = useEditorStore((s) => s.setSelectedPrimitiveId);
  const zoomTarget = useEditorStore((s) => s.zoomTarget);
  const setZoomTarget = useEditorStore((s) => s.setZoomTarget);
  const zoomLocked = useEditorStore((s) => s.zoomLocked);
  const toggleZoomLock = useEditorStore((s) => s.toggleZoomLock);
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
    setFloatingTool(null);
  }, [activeMapId]);

  useEffect(() => {
    if (!viewer || !zoomTarget || compareOnly) return;
    fitBBox(viewer, zoomTarget.bbox, dims, {
      immediate: zoomTarget.immediate ?? false,
      locked: zoomTarget.lockZoom ?? zoomLocked,
      padding: zoomTarget.padding,
    });
    setZoomTarget(null);
  }, [viewer, zoomTarget, setZoomTarget, zoomLocked, dims]);

  const zoomIn = useCallback(() => viewer?.viewport.zoomBy(1.5), [viewer]);
  const zoomOut = useCallback(() => viewer?.viewport.zoomBy(0.667), [viewer]);
  const goHome = useCallback(() => viewer?.viewport.goHome(), [viewer]);
  const openSearch = useCallback(() => {
    setLeftSidebarCollapsed(true);
    setFloatingTool(null);
    setShowQuickSearch(true);
    window.dispatchEvent(new Event('map-search-focus'));
  }, [setLeftSidebarCollapsed]);
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
    setGroupBuilderFocusSignal((value) => value + 1);
  }, [setLeftSidebarCollapsed]);
  const openPolylineTool = useCallback(() => {
    setLeftSidebarCollapsed(true);
    setShowQuickSearch(false);
    setFloatingTool('polyline');
    setSelectedPrimitiveId(null);
    setEditorMode('polygon');
    window.dispatchEvent(new Event('map-search-clear'));
    containerRef.current?.focus({ preventScroll: true });
  }, [setEditorMode, setLeftSidebarCollapsed, setSelectedPrimitiveId]);

  const handleWheelZoom = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!viewer) return;
      event.preventDefault();
      event.stopPropagation();
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
    [viewer]
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
        let handled = true;
        switch (event.key) {
          case '+':
          case '=':
            viewer.viewport.zoomBy(1.3);
            break;
          case '-':
          case '_':
            viewer.viewport.zoomBy(0.77);
            break;
          case 'ArrowUp':
            viewer.viewport.panBy(new OpenSeadragon.Point(0, -0.08));
            break;
          case 'ArrowDown':
            viewer.viewport.panBy(new OpenSeadragon.Point(0, 0.08));
            break;
          case 'ArrowLeft':
            viewer.viewport.panBy(new OpenSeadragon.Point(-0.08, 0));
            break;
          case 'ArrowRight':
            viewer.viewport.panBy(new OpenSeadragon.Point(0.08, 0));
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

      if (event.key === ' ' && !editing) {
        event.preventDefault();
        spaceHeldRef.current = true;
        setSpacePanActive(true);
        return;
      }

      if (event.key === 'Escape') {
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
        case 't':
        case 'T':
          setEditorMode(editorMode === 'textSelect' ? 'none' : 'textSelect');
          break;
        case '+':
        case '=':
          viewer.viewport.zoomBy(1.3);
          break;
        case '-':
        case '_':
          viewer.viewport.zoomBy(0.77);
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
        case '\\':
          toggleShowAllPrimitivesVisible();
          break;
        case 'ArrowUp':
          viewer.viewport.panBy(new OpenSeadragon.Point(0, -panSpeed));
          break;
        case 'ArrowDown':
          viewer.viewport.panBy(new OpenSeadragon.Point(0, panSpeed));
          break;
        case 'ArrowLeft':
          viewer.viewport.panBy(new OpenSeadragon.Point(-panSpeed, 0));
          break;
        case 'ArrowRight':
          viewer.viewport.panBy(new OpenSeadragon.Point(panSpeed, 0));
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
    setSpacePanActive,
    editorMode,
    clearDraftGroup,
    clearDraftPolygon,
    openStudyBoxTool,
    openGroupTool,
    openPolylineTool,
    openSearch,
    setEditorMode,
    toggleShowAllPrimitivesVisible,
    compareOnly,
  ]);

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-gray-900"
      onWheel={handleWheelZoom}
      style={{
        cursor:
          editorMode === 'textSelect'
            ? 'text'
            : editorMode === 'none' ||
              editorMode === 'groupCollect' ||
              editorMode === 'overlayNeighborPick'
            ? mapDragActive || spaceDragActive
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
      </div>

      {!compareOnly && showQuickSearch && (
        <div
          className="absolute top-16 z-20 -translate-x-1/2 origin-top transition-all duration-300"
          style={{ left: `calc(${leftInset}px + (100% - ${leftInset}px) / 2)` }}
        >
          <SearchBox
            floating
            autoFocus
            onRequestClose={() => setShowQuickSearch(false)}
          />
        </div>
      )}

      {!compareOnly && floatingTool === 'group' && (
        <div
          className="absolute top-16 z-20 w-80 max-w-[calc(100vw-5rem)] -translate-x-1/2"
          style={{ left: `calc(${leftInset}px + (100% - ${leftInset}px) / 2)` }}
        >
          <DrawTools
            mode="group"
            groupBuilderFocusSignal={groupBuilderFocusSignal}
            onRequestClose={() => setFloatingTool(null)}
          />
        </div>
      )}

      {!compareOnly && floatingTool === 'studybox' && (
        <div
          className="absolute top-16 z-20 w-fit max-w-[calc(100vw-5rem)] -translate-x-1/2"
          style={{ left: `calc(${leftInset}px + (100% - ${leftInset}px) / 2)` }}
        >
          <DrawTools
            mode="studybox"
            onRequestClose={() => setFloatingTool(null)}
          />
        </div>
      )}

      {!compareOnly && floatingTool === 'polyline' && (
        <div
          className="absolute top-16 z-20 w-fit max-w-[calc(100vw-5rem)] -translate-x-1/2"
          style={{ left: `calc(${leftInset}px + (100% - ${leftInset}px) / 2)` }}
        >
          <DrawTools
            mode="polyline"
            onRequestClose={() => setFloatingTool(null)}
          />
        </div>
      )}

      <div
        className="absolute bottom-4 z-10 flex -translate-x-1/2 items-center gap-3"
        style={{ left: `calc(${leftInset}px + (100% - ${leftInset}px) / 2)` }}
      >
        <div className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-[11px] text-white/70 backdrop-blur pointer-events-none">
          {compareOnly
            ? '+ zoom in · - zoom out · 0 home · drag pan'
            : '1 left · 2 right · 3 prev · 4 next · 5 search · 6 study box · 7 group · 8 polyline · 9 lock · 0 home · T text · \\ overlays · ? help'}
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
