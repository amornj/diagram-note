import OpenSeadragon from 'openseadragon';
import type { BBox, Point } from '../types';

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SourceDims {
  width: number;
  height: number;
}

export function bboxToImageRect(bbox: BBox, dims: SourceDims): PixelRect {
  return {
    x: bbox.x * dims.width,
    y: bbox.y * dims.height,
    width: bbox.w * dims.width,
    height: bbox.h * dims.height,
  };
}

export function bboxToViewportRect(
  viewer: OpenSeadragon.Viewer,
  bbox: BBox,
  dims: SourceDims
): OpenSeadragon.Rect | null {
  const r = bboxToImageRect(bbox, dims);
  return viewer.viewport.imageToViewportRectangle(r.x, r.y, r.width, r.height);
}

export function bboxToViewerElementRect(
  viewer: OpenSeadragon.Viewer,
  bbox: BBox,
  dims: SourceDims
): OpenSeadragon.Rect | null {
  const vp = bboxToViewportRect(viewer, bbox, dims);
  if (!vp) return null;
  return viewer.viewport.viewportToViewerElementRectangle(vp);
}

export function normalizedPointToViewerElementPoint(
  viewer: OpenSeadragon.Viewer,
  point: Point,
  dims: SourceDims
): OpenSeadragon.Point | null {
  const vp = viewer.viewport.imageToViewportCoordinates(
    point.x * dims.width,
    point.y * dims.height
  );
  return viewer.viewport.viewportToViewerElementCoordinates(vp);
}

export function viewerElementPointToNormalizedPoint(
  viewer: OpenSeadragon.Viewer,
  x: number,
  y: number,
  dims: SourceDims
): Point {
  const vp = viewer.viewport.viewerElementToViewportCoordinates(
    new OpenSeadragon.Point(x, y)
  );
  const img = viewer.viewport.viewportToImageCoordinates(vp);
  return {
    x: clamp01(img.x / dims.width),
    y: clamp01(img.y / dims.height),
  };
}

export function fitBBox(
  viewer: OpenSeadragon.Viewer,
  bbox: BBox,
  dims: SourceDims,
  options?: { padding?: number; immediate?: boolean; locked?: boolean; frozen?: boolean }
) {
  if (options?.frozen) return;
  const r = bboxToImageRect(bbox, dims);
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;

  if (options?.locked) {
    const center = viewer.viewport.imageToViewportCoordinates(cx, cy);
    viewer.viewport.panTo(center, options?.immediate ?? false);
    return;
  }

  const pad = options?.padding ?? 1.5;
  const fw = Math.max(r.width * pad, dims.width * 0.075);
  const fh = Math.max(r.height * pad, dims.height * 0.075);
  const fx = Math.max(0, Math.min(cx - fw / 2, dims.width - fw));
  const fy = Math.max(0, Math.min(cy - fh / 2, dims.height - fh));

  const vp = viewer.viewport.imageToViewportRectangle(fx, fy, fw, fh);
  viewer.viewport.fitBounds(vp, options?.immediate ?? false);
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}
