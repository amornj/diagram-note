import { jsPDF } from 'jspdf';
import * as idb from './idb';
import { getPrimitiveBounds } from './workspace';
import type { BBox, DiagramMap, MapWorkspace, Primitive } from '../types';

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

const GREEK_TO_LATIN: Record<string, string> = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon',
  ζ: 'zeta', η: 'eta', θ: 'theta', ι: 'iota', κ: 'kappa',
  λ: 'lambda', μ: 'mu', ν: 'nu', ξ: 'xi', ο: 'o', π: 'pi',
  ρ: 'rho', σ: 'sigma', ς: 'sigma', τ: 'tau', υ: 'upsilon',
  φ: 'phi', χ: 'chi', ψ: 'psi', ω: 'omega',
  Α: 'Alpha', Β: 'Beta', Γ: 'Gamma', Δ: 'Delta', Ε: 'Epsilon',
  Ζ: 'Zeta', Η: 'Eta', Θ: 'Theta', Ι: 'Iota', Κ: 'Kappa',
  Λ: 'Lambda', Μ: 'Mu', Ν: 'Nu', Ξ: 'Xi', Ο: 'O', Π: 'Pi',
  Ρ: 'Rho', Σ: 'Sigma', Τ: 'Tau', Υ: 'Upsilon', Φ: 'Phi',
  Χ: 'Chi', Ψ: 'Psi', Ω: 'Omega',
};

// jsPDF's built-in Helvetica is WinAnsi-only. Any character outside that
// encoding makes splitTextToSize fall back to per-character spacing — which
// is what made notes containing arrows/Greek render with huge gaps between
// every letter. Map common scientific glyphs to ASCII and strip the rest.
function sanitizeForPdf(text: string): string {
  if (!text) return text;
  let s = text;
  s = s.replace(/[→⇒⟶⟹]/g, ' -> ');
  s = s.replace(/[←⇐⟵⟸]/g, ' <- ');
  s = s.replace(/[↔⇔⟷⟺]/g, ' <-> ');
  s = s.replace(/[↑⇑]/g, '^');
  s = s.replace(/[↓⇓]/g, 'v');
  s = s.replace(/[≈∼∽]/g, '~');
  s = s.replace(/≡/g, '===');
  s = s.replace(/≠/g, '!=');
  s = s.replace(/≤/g, '<=');
  s = s.replace(/≥/g, '>=');
  s = s.replace(/[×⨯]/g, 'x');
  s = s.replace(/÷/g, '/');
  s = s.replace(/√/g, 'sqrt');
  s = s.replace(/∞/g, 'inf');
  s = s.replace(/[∑]/g, 'Sum');
  s = s.replace(/[∏]/g, 'Prod');
  s = s.replace(/[∫]/g, 'Int');
  s = s.replace(/[∂]/g, 'd');
  s = s.replace(/[Ͱ-Ͽ]/g, (c) => GREEK_TO_LATIN[c] ?? '?');
  // Final guard: anything still outside Latin-1 + WinAnsi punctuation
  // (smart quotes, em/en dash, bullet, ellipsis, euro, trademark) gets `?`
  // so a stray glyph never breaks layout for the whole line.
  s = s.replace(
    /[^\x00-\xFF‘’‚“”„†‡•…‰‹›€™]/g,
    '?'
  );
  // Collapse the double-spaces introduced by inserting ' -> ' etc.
  s = s.replace(/ {2,}/g, ' ');
  return s;
}

function getPriorityNote(p: Primitive) {
  return p.notes?.find((n) => n.isPriority && n.content.trim()) ?? null;
}

function getContentNotes(p: Primitive) {
  return (p.notes ?? []).filter((n) => n.content.trim());
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

function drawNumberedBubble(
  ctx: CanvasRenderingContext2D,
  bounds: BBox,
  number: number,
  W: number,
  H: number,
  scale: number
) {
  const digits = String(number).length;
  // Bubble grows slightly wider for multi-digit numbers so the text fits.
  const baseW = 22 + digits * 6;
  const baseH = 20;
  const bw = baseW * scale;
  const bh = baseH * scale;
  const gap = 6 * scale;
  const margin = 4 * scale;

  // Default: just to the right of the primitive, top-aligned with its top edge.
  let bx = (bounds.x + bounds.w) * W + gap;
  let by = bounds.y * H;

  // Slide left/right if the bubble would leave the canvas.
  if (bx + bw > W - margin) {
    // No room on the right — drop onto the left side of the primitive instead.
    const leftBx = bounds.x * W - bw - gap;
    bx = leftBx >= margin ? leftBx : W - bw - margin;
  }
  by = clamp(by, margin, H - bh - margin);

  ctx.save();
  ctx.fillStyle = '#fff8eb';
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2 * scale;

  const r = 7 * scale;
  const tailLen = 6 * scale;
  ctx.beginPath();
  ctx.moveTo(bx + r, by);
  ctx.lineTo(bx + bw - r, by);
  ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
  ctx.lineTo(bx + bw, by + bh - r);
  ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
  ctx.lineTo(bx + r, by + bh);
  ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
  // Triangle tail on the left edge, pointing at the primitive.
  ctx.lineTo(bx - tailLen, by + bh / 2);
  ctx.lineTo(bx, by + r);
  ctx.quadraticCurveTo(bx, by, bx + r, by);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const fontSize = 12 * scale;
  ctx.font = `700 ${fontSize}px system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = '#b45309';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(number), bx + bw / 2, by + bh / 2);
  ctx.restore();
}

function readingOrder(a: BBox, b: BBox): number {
  // Group by horizontal bands so small y-jitter doesn't reshuffle rows.
  const bandA = Math.floor(a.y / 0.05);
  const bandB = Math.floor(b.y / 0.05);
  if (bandA !== bandB) return bandA - bandB;
  return a.x - b.x;
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

  // Layer all overlays under the bubbles.
  for (const primitive of workspace.primitives) {
    if (primitive.kind === 'group') continue;
    drawPrimitive(ctx, primitive, W, H, strokeWidth);
  }

  // Collect primitives whose priority note should be surfaced; sort in
  // reading order so the numbering reads naturally top-to-bottom, left-to-right.
  const numbered = workspace.primitives
    .filter((p) => p.showPriorityNote === true && getPriorityNote(p))
    .map((p) => ({ primitive: p, bounds: getPrimitiveBounds(p, primitivesById) }))
    .filter(
      (entry): entry is { primitive: Primitive; bounds: BBox } => entry.bounds !== null
    )
    .sort((a, b) => readingOrder(a.bounds, b.bounds))
    .map((entry, i) => ({ ...entry, number: i + 1 }));

  for (const { bounds, number } of numbered) {
    drawNumberedBubble(ctx, bounds, number, W, H, bubbleScale);
  }

  // Portrait A4 PDF. The map sits at the top of page 1 and the notes flow
  // directly beneath it; a new page is only added when the notes actually
  // run past the bottom margin.
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 36;
  const contentX = margin;
  const contentW = pageW - margin * 2;

  // --- Map at the top of page 1 ---
  // Fit to content width, preserving aspect. Cap height so at least the notes
  // section heading fits on the same page when the map is portrait-ish.
  const canvasAspect = W / H;
  const maxMapH = (pageH - margin * 2) * 0.75;
  let mapDrawW = contentW;
  let mapDrawH = mapDrawW / canvasAspect;
  if (mapDrawH > maxMapH) {
    mapDrawH = maxMapH;
    mapDrawW = mapDrawH * canvasAspect;
  }
  const mapDrawX = (pageW - mapDrawW) / 2;
  const mapDrawY = margin;
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  pdf.addImage(dataUrl, 'JPEG', mapDrawX, mapDrawY, mapDrawW, mapDrawH);

  // --- Notes flow directly beneath the map ---
  if (numbered.length > 0) {
    const headingSize = 13;
    const noteNameSize = 11;
    const bodySize = 10;
    const headingLineHeight = 18;
    const noteNameLineHeight = 15;
    const bodyLineHeight = 14;
    const interNoteSpacing = 4;
    const interItemSpacing = 12;
    let y = mapDrawY + mapDrawH + 18;

    const ensureSpace = (need: number) => {
      if (y + need > pageH - margin) {
        pdf.addPage();
        y = margin;
      }
    };

    // Section title — "Notes From <map name> <DD Month YYYY>". Long map names
    // wrap onto a second line via splitTextToSize so the date is never lost.
    const dateStr = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date());
    const titleText = sanitizeForPdf(
      `Notes From ${map.name || 'Untitled map'} ${dateStr}`
    );
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(15);
    const titleLineHeight = 19;
    const titleLines = pdf.splitTextToSize(titleText, contentW) as string[];
    ensureSpace(titleLines.length * titleLineHeight + 8);
    for (const line of titleLines) {
      pdf.text(line, contentX, y + 14);
      y += titleLineHeight;
    }
    y += 8;

    for (const { primitive, number } of numbered) {
      const notes = getContentNotes(primitive);
      ensureSpace(headingLineHeight + bodyLineHeight);

      // "1. Glycolysis" — the numbered heading
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(headingSize);
      const heading = sanitizeForPdf(`${number}. ${primitive.name || 'Untitled'}`);
      pdf.text(heading, contentX, y + headingSize);
      y += headingLineHeight;

      if (notes.length === 0) {
        pdf.setFont('helvetica', 'italic');
        pdf.setFontSize(bodySize);
        pdf.setTextColor(120);
        pdf.text('(no note)', contentX + 12, y + bodySize);
        pdf.setTextColor(0);
        y += bodyLineHeight + interItemSpacing;
        continue;
      }

      // When a primitive has more than one note, each is bulleted so the
      // list is visually scannable. A single-note primitive stays flat.
      const useBullets = notes.length > 1;
      const bulletX = contentX + 12;
      const textX = contentX + (useBullets ? 22 : 12);
      const wrapWidth = contentW - (useBullets ? 22 : 12);

      for (let i = 0; i < notes.length; i++) {
        const note = notes[i];
        let bulletDrawn = false;
        const drawBullet = (baselineY: number) => {
          if (!useBullets || bulletDrawn) return;
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(bodySize);
          pdf.text('•', bulletX, baselineY);
          bulletDrawn = true;
        };

        if (useBullets && note.name.trim()) {
          ensureSpace(noteNameLineHeight);
          drawBullet(y + noteNameSize);
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(noteNameSize);
          pdf.text(sanitizeForPdf(note.name.trim()), textX, y + noteNameSize);
          y += noteNameLineHeight;
        }

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(bodySize);
        const lines = pdf.splitTextToSize(
          sanitizeForPdf(note.content.trim()),
          wrapWidth
        ) as string[];
        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
          ensureSpace(bodyLineHeight);
          if (lineIdx === 0) drawBullet(y + bodySize);
          pdf.text(lines[lineIdx], textX, y + bodySize);
          y += bodyLineHeight;
        }
        if (i < notes.length - 1) y += interNoteSpacing;
      }
      y += interItemSpacing;
    }
  }

  return pdf.output('blob');
}
