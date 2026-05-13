import { jsPDF } from 'jspdf';
import * as idb from './idb';
import { getPrimitiveBounds, parseMemberKey } from './workspace';
import type { BBox, DiagramMap, MapWorkspace, Primitive } from '../types';

const BUBBLE_MIN_W = 180;
const BUBBLE_MAX_W = 340;
const BUBBLE_PAD_X = 14;
const BUBBLE_PAD_TOP = 22;
const BUBBLE_PAD_BOTTOM = 14;
const BUBBLE_LINE_HEIGHT = 16;
const BUBBLE_CHAR_LIMIT = 42;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function wrapText(content: string, limit: number): string[] {
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

function layoutBubble(content: string) {
  const rawLines = content.trim().split(/\r?\n/);
  const longestRaw = rawLines.reduce((m, l) => Math.max(m, l.trim().length), 0);
  const target = clamp(
    Math.max(18, Math.min(longestRaw, BUBBLE_CHAR_LIMIT)),
    18,
    BUBBLE_CHAR_LIMIT
  );
  const lines = wrapText(content, target);
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
  const width = clamp(longest * 6.8 + BUBBLE_PAD_X * 2, BUBBLE_MIN_W, BUBBLE_MAX_W);
  const height = BUBBLE_PAD_TOP + BUBBLE_PAD_BOTTOM + lines.length * BUBBLE_LINE_HEIGHT;
  return { lines, width, height };
}

function getPriorityNote(p: Primitive) {
  return p.notes?.find((n) => n.isPriority && n.content.trim()) ?? null;
}

function hexWithAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return hex;
  const r = parseInt(match[1], 16);
  const g = parseInt(match[2], 16);
  const b = parseInt(match[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load raster image'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawPrimitive(
  ctx: CanvasRenderingContext2D,
  p: Primitive,
  W: number,
  H: number,
  strokeWidth: number
) {
  const color = p.color || '#7c3aed';
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = strokeWidth;
  ctx.strokeStyle = color;

  if (p.kind === 'rectangle' && p.bbox) {
    const x = p.bbox.x * W;
    const y = p.bbox.y * H;
    const w = p.bbox.w * W;
    const h = p.bbox.h * H;
    const r = Math.min(12, w / 4, h / 4);
    roundedRectPath(ctx, x, y, w, h, r);
    ctx.fillStyle = hexWithAlpha(color, 0.09);
    ctx.fill();
    ctx.stroke();
    if (p.showLabel && p.name) {
      drawLabel(ctx, p.name, x, y, color, strokeWidth);
    }
  } else if (p.kind === 'polygon' && p.points && p.points.length >= 3) {
    ctx.beginPath();
    p.points.forEach((pt, i) => {
      const px = pt.x * W;
      const py = pt.y * H;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fillStyle = hexWithAlpha(color, 0.13);
    ctx.fill();
    ctx.stroke();
  } else if (p.kind === 'customline' && p.points && p.points.length >= 2) {
    ctx.beginPath();
    p.points.forEach((pt, i) => {
      const px = pt.x * W;
      const py = pt.y * H;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.fillStyle = color;
    for (const pt of p.points) {
      ctx.beginPath();
      ctx.arc(pt.x * W, pt.y * H, strokeWidth * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  strokeWidth: number
) {
  const fontSize = strokeWidth * 5;
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
  ctx.textBaseline = 'middle';
  const metrics = ctx.measureText(text);
  const padX = fontSize * 0.6;
  const padY = fontSize * 0.3;
  const bgW = metrics.width + padX * 2;
  const bgH = fontSize + padY * 2;
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(x, y - bgH - 2, bgW, bgH);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x + padX, y - bgH / 2 - 2);
  ctx.restore();
}

function drawSpeechBubble(
  ctx: CanvasRenderingContext2D,
  primitive: Primitive,
  content: string,
  bounds: BBox,
  W: number,
  H: number,
  scale: number
) {
  const layout = layoutBubble(content);
  const bw = layout.width * scale;
  const bh = layout.height * scale;

  const anchor =
    primitive.priorityNoteAnchor ?? {
      x: clamp(bounds.x + bounds.w / 2, 0.02, 0.98),
      y: clamp(bounds.y - 0.06, 0.02, 0.98),
    };

  const bx = anchor.x * W - bw / 2;
  const by = anchor.y * H;

  const primCenterX = (bounds.x + bounds.w / 2) * W;
  const primTopY = bounds.y * H;
  const tailGap = 14 * scale;
  const bubbleBottom = by + bh;
  const hasTail = bubbleBottom + tailGap < primTopY;
  const tailMidX = clamp(primCenterX, bx + 24 * scale, bx + bw - 24 * scale);

  ctx.save();
  ctx.fillStyle = '#fff8eb';
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2 * scale;

  const r = 18 * scale;
  ctx.beginPath();
  ctx.moveTo(bx + r, by);
  ctx.lineTo(bx + bw - r, by);
  ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
  ctx.lineTo(bx + bw, by + bh - r);
  ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
  if (hasTail) {
    ctx.lineTo(tailMidX + 8 * scale, by + bh);
    ctx.lineTo(tailMidX, primTopY - 2 * scale);
    ctx.lineTo(tailMidX - 6 * scale, by + bh);
  }
  ctx.lineTo(bx + r, by + bh);
  ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
  ctx.lineTo(bx, by + r);
  ctx.quadraticCurveTo(bx, by, bx + r, by);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const fontSize = 12 * scale;
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = '#7c2d12';
  ctx.textBaseline = 'top';
  let textY = by + (BUBBLE_PAD_TOP - 12) * scale;
  for (const line of layout.lines) {
    ctx.fillText(line, bx + BUBBLE_PAD_X * scale, textY);
    textY += BUBBLE_LINE_HEIGHT * scale;
  }
  ctx.restore();
}

export async function buildMapOverlayPdf(
  map: DiagramMap,
  workspace: MapWorkspace
): Promise<Blob> {
  const raster = await idb.getRaster(map.id, map.renderScale, map.pageIndex);
  if (!raster) throw new Error('Raster image not found for this page');

  const img = await loadImage(raster.blob);
  const W = img.naturalWidth;
  const H = img.naturalHeight;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  ctx.drawImage(img, 0, 0);

  const primitivesById = new Map(workspace.primitives.map((p) => [p.id, p]));
  const strokeWidth = Math.max(2, Math.min(W, H) * 0.0028);
  const bubbleScale = Math.max(1.4, Math.min(W, H) / 900);

  for (const primitive of workspace.primitives) {
    if (primitive.kind === 'group') continue;
    drawPrimitive(ctx, primitive, W, H, strokeWidth);
  }

  for (const primitive of workspace.primitives) {
    if (primitive.showPriorityNote !== true) continue;
    const priorityNote = getPriorityNote(primitive);
    if (!priorityNote) continue;
    let bounds: BBox | null;
    if (primitive.kind === 'group') {
      bounds = null;
      const keys = primitive.groupMemberKeys ?? [];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const key of keys) {
        const parsed = parseMemberKey(key);
        if (!parsed) continue;
        const member = primitivesById.get(parsed.id);
        if (!member) continue;
        const mb = getPrimitiveBounds(member, primitivesById);
        if (!mb) continue;
        minX = Math.min(minX, mb.x);
        minY = Math.min(minY, mb.y);
        maxX = Math.max(maxX, mb.x + mb.w);
        maxY = Math.max(maxY, mb.y + mb.h);
      }
      if (Number.isFinite(minX)) {
        bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
      }
    } else {
      bounds = getPrimitiveBounds(primitive, primitivesById);
    }
    if (!bounds) continue;
    drawSpeechBubble(ctx, primitive, priorityNote.content, bounds, W, H, bubbleScale);
  }

  // Force landscape: PDF page is sized so width >= height.
  const pdfW = Math.max(W, H);
  const pdfH = Math.min(W, H);
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: [pdfW, pdfH],
  });

  const canvasAspect = W / H;
  const pageAspect = pdfW / pdfH;
  let drawW: number;
  let drawH: number;
  if (canvasAspect > pageAspect) {
    drawW = pdfW;
    drawH = pdfW / canvasAspect;
  } else {
    drawH = pdfH;
    drawW = pdfH * canvasAspect;
  }
  const drawX = (pdfW - drawW) / 2;
  const drawY = (pdfH - drawH) / 2;

  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  pdf.addImage(dataUrl, 'JPEG', drawX, drawY, drawW, drawH);

  return pdf.output('blob');
}
