import type { DiagramMap, MapWorkspace } from '../types';

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

function safeJson(value: unknown): string {
  // Avoid prematurely closing the <script> tag and breaking HTML parsing.
  return JSON.stringify(value)
    .replace(/<\/(script)/gi, '<\\/$1')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function buildMapExportHtml(args: {
  map: DiagramMap;
  workspace: MapWorkspace;
  rasterBlob: Blob;
  dims: { width: number; height: number };
}): Promise<{ blob: Blob; filename: string }> {
  const { map, workspace, rasterBlob, dims } = args;
  const imageDataUrl = await blobToDataUrl(rasterBlob);
  const payload = {
    name: map.name,
    dims,
    primitives: workspace.primitives ?? [],
  };
  const html = renderHtml(map.name, imageDataUrl, payload);
  const safeName = map.name.replace(/[^a-z0-9-_ ]+/gi, '_').trim() || 'map';
  const suffix = (map.pageCount ?? 1) > 1 ? ` p${map.pageIndex + 1}` : '';
  return {
    blob: new Blob([html], { type: 'text/html' }),
    filename: `${safeName}${suffix} viewer.html`,
  };
}

function renderHtml(title: string, imageDataUrl: string, payload: unknown): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${escapeHtml(title)}</title>
<style>${VIEWER_CSS}</style>
</head>
<body>
<div id="viewport" tabindex="0">
  <div id="content">
    <img id="map-img" alt="" draggable="false" src="${imageDataUrl}" />
    <svg id="overlay" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"></svg>
  </div>
  <div id="notes-layer"></div>
</div>
<div id="toolbar" role="toolbar">
  <button data-act="zoom-in" title="Zoom in (+)" aria-label="Zoom in">＋</button>
  <button data-act="zoom-out" title="Zoom out (-)" aria-label="Zoom out">−</button>
  <button data-act="zoom-lock" title="Lock zoom (9)" aria-label="Lock zoom">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
  </button>
  <button data-act="pan-lock" title="Pin map (P)" aria-label="Pin map">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76V6.5a2.5 2.5 0 0 1 5 0v4.26"/><path d="M5 17h14l-2.5-3h-9z"/></svg>
  </button>
  <button data-act="home" title="Reset view (0)" aria-label="Reset view">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/></svg>
  </button>
  <button data-act="occlusion" title="Occlude study boxes (Shift+O)" aria-label="Occlusion mode">
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="13" x2="13" y2="3"/><line x1="3" y1="21" x2="21" y2="3"/><line x1="11" y1="21" x2="21" y2="11"/></svg>
  </button>
  <button data-act="overlays" title="Show all overlays (\\)" aria-label="Show overlays">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>
  </button>
  <button data-act="notes" title="Show notes (N)" aria-label="Show notes">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-7l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>
  </button>
</div>
<div id="hint">
  ＋/− zoom · 9 lock zoom · P pin · 0 home · ⇧O occlude · \\ overlays · N notes · drag to pan
</div>
<div id="title-tag">${escapeHtml(title)} · view only</div>
<script>window.__VIEWER_DATA__ = ${safeJson(payload)};</script>
<script>${VIEWER_JS}</script>
</body>
</html>`;
}

const VIEWER_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; background: #0f172a; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #0f172a; }
#viewport { position: absolute; inset: 0; overflow: hidden; cursor: grab; outline: none; touch-action: none; -webkit-user-select: none; user-select: none; }
#viewport.dragging { cursor: grabbing; }
#viewport.pan-locked { cursor: default; }
#content { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
#map-img { display: block; user-select: none; -webkit-user-drag: none; }
#overlay { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
#overlay .hit { pointer-events: auto; cursor: pointer; }
#notes-layer { position: absolute; inset: 0; pointer-events: none; }
#toolbar { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); display: flex; gap: 4px; padding: 8px; background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); backdrop-filter: blur(8px); z-index: 50; }
#toolbar button { width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; border-radius: 10px; border: none; background: rgba(255,255,255,0.92); color: #1f2937; font-size: 18px; font-weight: 600; cursor: pointer; transition: background-color 120ms, color 120ms; }
#toolbar button:hover { background: #fff; }
#toolbar button.active { background: #0ea5e9; color: #fff; }
#toolbar button.warn { background: #fcd34d; color: #78350f; }
#toolbar button.lock-on { background: #fde68a; color: #92400e; }
#toolbar button.pin-on { background: #fecdd3; color: #9f1239; }
#hint { position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%); padding: 6px 12px; background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.1); border-radius: 999px; color: rgba(255,255,255,0.78); font-size: 11px; letter-spacing: 0.01em; z-index: 40; backdrop-filter: blur(8px); }
#title-tag { position: absolute; top: 16px; left: 16px; padding: 6px 12px; background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; color: #fff; font-size: 12px; font-weight: 600; z-index: 40; max-width: 40vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; backdrop-filter: blur(8px); }

.note-card { position: absolute; pointer-events: auto; min-width: 200px; max-width: 320px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.18); padding: 10px 12px; color: #422006; font-size: 13px; line-height: 1.4; }
.note-card .note-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; cursor: grab; }
.note-card .note-header.dragging { cursor: grabbing; }
.note-card .note-title { font-weight: 700; font-size: 12px; color: #78350f; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.note-card .note-close { background: transparent; border: none; padding: 2px 6px; color: #92400e; font-size: 16px; line-height: 1; cursor: pointer; border-radius: 6px; }
.note-card .note-close:hover { background: rgba(120,53,15,0.1); }
.note-card .note-tabs { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 6px; }
.note-card .note-tab { background: rgba(252,211,77,0.4); color: #78350f; border: none; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; cursor: pointer; }
.note-card .note-tab.active { background: #f59e0b; color: #fff; }
.note-card .note-body { white-space: pre-wrap; word-wrap: break-word; max-height: 320px; overflow-y: auto; }
.note-card .note-name { font-size: 11px; color: #92400e; font-weight: 600; margin-bottom: 4px; }

.priority-bubble { position: absolute; pointer-events: auto; min-width: 180px; max-width: 320px; background: #fffbeb; border: 2px solid currentColor; border-radius: 10px; padding: 8px 12px; font-size: 12px; line-height: 1.4; color: #78350f; box-shadow: 0 6px 18px rgba(0,0,0,0.15); cursor: grab; }
.priority-bubble.dragging { cursor: grabbing; }
.priority-bubble .pri-toggle { position: absolute; top: -8px; right: -8px; width: 18px; height: 18px; border-radius: 999px; background: #f59e0b; color: #fff; border: 2px solid #fff; font-size: 10px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; pointer-events: auto; }
.priority-bubble .pri-content { display: block; max-height: 240px; overflow-y: auto; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: anywhere; }
.priority-bubble .pri-name { font-size: 10px; color: #92400e; font-weight: 700; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.03em; }
.priority-bubble.collapsed { min-width: 0; max-width: none; width: 34px; height: 30px; padding: 0; background: transparent; border: none; box-shadow: none; cursor: pointer; }
.priority-bubble.collapsed .pri-content,
.priority-bubble.collapsed .pri-toggle { display: none; }
.pri-collapsed-icon { display: none; width: 100%; height: 100%; align-items: center; justify-content: center; color: inherit; }
.priority-bubble.collapsed .pri-collapsed-icon { display: flex; }
.pri-collapsed-icon svg { width: 30px; height: 30px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.25)); }
.pri-collapsed-icon svg .speech-fill { fill: #fffbeb; }
.pri-collapsed-icon svg .speech-stroke { fill: currentColor; }
`;

// The viewer JS — read once into a string at build time.
// Keep no template-literal back-references so this file can be served as plain text.
const VIEWER_JS = String.raw`
(function () {
  const DATA = window.__VIEWER_DATA__ || { dims: { width: 1, height: 1 }, primitives: [] };
  const { dims, primitives } = DATA;

  // ---------- elements ----------
  const viewport = document.getElementById('viewport');
  const content = document.getElementById('content');
  const img = document.getElementById('map-img');
  const overlay = document.getElementById('overlay');
  const notesLayer = document.getElementById('notes-layer');
  const toolbar = document.getElementById('toolbar');

  img.width = dims.width;
  img.height = dims.height;
  content.style.width = dims.width + 'px';
  content.style.height = dims.height + 'px';
  overlay.setAttribute('viewBox', '0 0 ' + dims.width + ' ' + dims.height);
  overlay.style.width = dims.width + 'px';
  overlay.style.height = dims.height + 'px';

  // ---------- state ----------
  const state = {
    tx: 0, ty: 0, scale: 1,
    zoomLocked: false,
    panLocked: false,
    showAllOverlays: false,
    occluded: new Set(),   // rectangle IDs currently rendered as solid blue blocks
    notesVisible: false,   // master toggle — speech bubbles only render when true
    selectedNoteId: null,
    noteOffset: {},        // primitiveId -> {dx, dy} screen offset for note bubble
    priorityOffset: {},    // primitiveId -> {dx, dy} screen offset for priority bubble
    priorityCollapsed: {}, // primitiveId -> bool (collapse to speech-bubble icon)
  };

  // ---------- helpers ----------
  const byId = new Map(primitives.map((p) => [p.id, p]));

  function parseMemberKey(key) {
    if (typeof key !== 'string' || key.indexOf('primitive:') !== 0) return null;
    return { id: key.slice('primitive:'.length) };
  }

  function bboxFromPoints(points) {
    if (!points || !points.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function getBounds(primitive) {
    if (primitive.bbox) return primitive.bbox;
    if (primitive.points && primitive.points.length) return bboxFromPoints(primitive.points);
    if (primitive.kind === 'group') {
      const boxes = [];
      for (const key of primitive.groupMemberKeys || []) {
        const member = parseMemberKey(key);
        if (!member) continue;
        const mp = byId.get(member.id);
        if (!mp) continue;
        const b = getBounds(mp);
        if (b) boxes.push(b);
      }
      if (!boxes.length) return null;
      const minX = Math.min.apply(null, boxes.map((b) => b.x));
      const minY = Math.min.apply(null, boxes.map((b) => b.y));
      const maxX = Math.max.apply(null, boxes.map((b) => b.x + b.w));
      const maxY = Math.max.apply(null, boxes.map((b) => b.y + b.h));
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    return null;
  }

  function getPriorityNote(primitive) {
    return (primitive.notes || []).find((n) => n.isPriority && n.content && n.content.trim()) || null;
  }

  // Default: every priority bubble starts collapsed (as a speech-bubble icon).
  for (const p of primitives) {
    if (p.showPriorityNote === true && getPriorityNote(p)) {
      state.priorityCollapsed[p.id] = true;
    }
  }

  // ---------- view transform ----------
  function applyTransform() {
    content.style.transform = 'translate(' + state.tx + 'px,' + state.ty + 'px) scale(' + state.scale + ')';
    renderNotes();
  }

  function fit() {
    const rect = viewport.getBoundingClientRect();
    const sx = rect.width / dims.width;
    const sy = rect.height / dims.height;
    const s = Math.min(sx, sy) * 0.95;
    state.scale = s;
    state.tx = (rect.width - dims.width * s) / 2;
    state.ty = (rect.height - dims.height * s) / 2;
    applyTransform();
  }

  function zoomAt(pivotX, pivotY, factor) {
    if (state.zoomLocked) return;
    const next = Math.max(0.05, Math.min(20, state.scale * factor));
    const k = next / state.scale;
    state.tx = pivotX - (pivotX - state.tx) * k;
    state.ty = pivotY - (pivotY - state.ty) * k;
    state.scale = next;
    applyTransform();
  }

  // ---------- pan / wheel ----------
  let panState = null;

  viewport.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.note-card, .priority-bubble, #toolbar')) return;
    if (state.panLocked) return;
    if (event.target.closest('.hit')) {
      // Allow primitives to handle their own clicks; pan only on background.
      return;
    }
    panState = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    viewport.classList.add('dragging');
    try { viewport.setPointerCapture(event.pointerId); } catch (_) {}
  });

  viewport.addEventListener('pointermove', (event) => {
    if (!panState || panState.id !== event.pointerId) return;
    const dx = event.clientX - panState.x;
    const dy = event.clientY - panState.y;
    panState.x = event.clientX;
    panState.y = event.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 1) panState.moved = true;
    state.tx += dx;
    state.ty += dy;
    applyTransform();
  });

  function endPan(event) {
    if (!panState || panState.id !== event.pointerId) return;
    panState = null;
    viewport.classList.remove('dragging');
  }
  viewport.addEventListener('pointerup', endPan);
  viewport.addEventListener('pointercancel', endPan);

  viewport.addEventListener('click', (event) => {
    if (event.target.closest('.note-card, .priority-bubble, .hit, #toolbar')) return;
    state.selectedNoteId = null;
    renderNotes();
  });

  viewport.addEventListener('wheel', (event) => {
    if (state.zoomLocked) { event.preventDefault(); return; }
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2;
    zoomAt(px, py, factor);
  }, { passive: false });

  // ---------- overlay rendering ----------
  function escapeAttr(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function setAttrs(node, attrs) {
    for (const k in attrs) node.setAttribute(k, attrs[k]);
  }

  function makeSvgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) setAttrs(el, attrs);
    return el;
  }

  // Determine which primitives are "grouped" study boxes — used for show/hide rules.
  const groupedStudyBoxIds = new Set();
  for (const p of primitives) {
    if (p.kind !== 'group') continue;
    for (const key of p.groupMemberKeys || []) {
      const m = parseMemberKey(key);
      if (!m) continue;
      const mp = byId.get(m.id);
      if (mp && mp.kind === 'rectangle') groupedStudyBoxIds.add(mp.id);
    }
  }

  function shouldShowPrimitive(primitive) {
    if (state.showAllOverlays) return true;
    if (primitive.showOnLoad === true) return true;
    return false; // default hidden until "show all" is on or selected
  }

  function renderOverlay() {
    overlay.innerHTML = '';
    const defs = makeSvgEl('defs');
    overlay.appendChild(defs);

    // Build primitive shapes. Render groups first so members stay on top.
    const order = primitives.slice().sort((a, b) => {
      if (a.kind === 'group' && b.kind !== 'group') return -1;
      if (a.kind !== 'group' && b.kind === 'group') return 1;
      return 0;
    });

    for (const primitive of order) {
      const bounds = getBounds(primitive);
      if (!bounds && primitive.kind !== 'group') continue;
      const visible = shouldShowPrimitive(primitive);
      const color = primitive.color || '#fb7185';
      const isOccludedBox =
        primitive.kind === 'rectangle' && state.occluded.has(primitive.id);
      const isStudyBox = primitive.kind === 'rectangle';

      if (primitive.kind === 'customline' && primitive.points && primitive.points.length >= 2) {
        const points = primitive.points
          .map((p) => (p.x * dims.width) + ',' + (p.y * dims.height))
          .join(' ');
        const line = makeSvgEl('polyline', {
          points,
          fill: 'none',
          stroke: visible ? color : 'transparent',
          'stroke-width': visible ? 2 : 14,
          'stroke-linejoin': 'round',
          'stroke-linecap': 'round',
          'stroke-dasharray': '8 5',
          'vector-effect': 'non-scaling-stroke',
          class: 'hit',
          'data-id': primitive.id,
        });
        overlay.appendChild(line);
        continue;
      }

      if (primitive.kind === 'polygon' && primitive.points && primitive.points.length >= 3) {
        const pts = primitive.points
          .map((p) => (p.x * dims.width) + ',' + (p.y * dims.height))
          .join(' ');
        const poly = makeSvgEl('polygon', {
          points: pts,
          fill: visible ? (color + '22') : 'transparent',
          stroke: visible ? color : 'transparent',
          'stroke-width': 2,
          'stroke-linejoin': 'round',
          'stroke-dasharray': '8 5',
          'vector-effect': 'non-scaling-stroke',
          class: 'hit',
          'data-id': primitive.id,
        });
        overlay.appendChild(poly);
        continue;
      }

      if (primitive.kind === 'rectangle' && bounds) {
        const x = bounds.x * dims.width;
        const y = bounds.y * dims.height;
        const w = bounds.w * dims.width;
        const h = bounds.h * dims.height;
        const r = Math.min(12, w * 0.06, h * 0.06);

        if (isOccludedBox) {
          // Anki-style occlusion: solid sky-blue overlay; click reveals.
          const occ = makeSvgEl('rect', {
            x: x, y: y, width: w, height: h, rx: r,
            fill: '#7dd3fc',
            stroke: '#0284c7',
            'stroke-width': 2,
            'vector-effect': 'non-scaling-stroke',
            class: 'hit',
            'data-id': primitive.id,
          });
          overlay.appendChild(occ);
        } else {
          const rect = makeSvgEl('rect', {
            x: x, y: y, width: w, height: h, rx: r,
            fill: visible ? (color + '18') : 'transparent',
            stroke: visible ? color : 'transparent',
            'stroke-width': visible ? 2 : 14,
            'vector-effect': 'non-scaling-stroke',
            class: 'hit',
            'data-id': primitive.id,
          });
          overlay.appendChild(rect);

          if (visible && primitive.showLabel && primitive.name) {
            const label = makeSvgEl('g', { 'pointer-events': 'none' });
            const labelW = Math.max(12, primitive.name.length * 7 + 12);
            const labelBg = makeSvgEl('rect', {
              x: x, y: y - 18, width: labelW, height: 16, rx: 3, fill: color, opacity: 0.9,
            });
            const labelText = makeSvgEl('text', {
              x: x + 6, y: y - 6, fill: 'white', 'font-size': 11, 'font-weight': 600,
            });
            labelText.textContent = primitive.name;
            label.appendChild(labelBg);
            label.appendChild(labelText);
            overlay.appendChild(label);
          }
        }
        continue;
      }

      if (primitive.kind === 'group' && bounds) {
        if (!visible) continue;
        const cx = (bounds.x + bounds.w / 2) * dims.width;
        const cy = (bounds.y - 0.005) * dims.height;
        const marker = makeSvgEl('g', { class: 'hit', 'data-id': primitive.id });
        const dot = makeSvgEl('circle', {
          cx: cx, cy: cy, r: 8, fill: color, stroke: '#ffffff', 'stroke-width': 2,
          'vector-effect': 'non-scaling-stroke',
        });
        marker.appendChild(dot);
        if (primitive.name) {
          const t = makeSvgEl('text', {
            x: cx + 12, y: cy + 4, fill: color, 'font-size': 12, 'font-weight': 700,
            'pointer-events': 'none',
          });
          t.textContent = primitive.name;
          marker.appendChild(t);
        }
        overlay.appendChild(marker);
        continue;
      }
    }
  }

  overlay.addEventListener('click', (event) => {
    const node = event.target.closest('.hit');
    if (!node) return;
    if (panState && panState.moved) return;
    const id = node.getAttribute('data-id');
    if (!id) return;
    event.stopPropagation();
    const primitive = byId.get(id);
    if (!primitive) return;
    if (primitive.kind === 'rectangle') {
      if (state.occluded.has(id)) state.occluded.delete(id);
      else state.occluded.add(id);
      refreshToolbar();
      renderOverlay();
      return;
    }
    if (!state.notesVisible || !getPriorityNote(primitive)) {
      state.selectedNoteId = null;
      renderNotes();
      return;
    }
    state.selectedNoteId = id;
    renderNotes();
  });

  // ---------- notes / priority bubbles (screen-space DOM) ----------
  function imageToScreen(ix, iy) {
    return {
      x: state.tx + ix * state.scale,
      y: state.ty + iy * state.scale,
    };
  }

  function buildPriorityBubbleEl(primitive, screenX, screenY, offset) {
    const note = getPriorityNote(primitive);
    if (!note) return null;
    const el = document.createElement('div');
    el.className = 'priority-bubble';
    el.style.color = primitive.color || '#b45309';
    const collapsed = state.priorityCollapsed[primitive.id] === true;
    if (collapsed) el.classList.add('collapsed');
    const dx = offset ? offset.dx : 0;
    const dy = offset ? offset.dy : 0;
    el.style.left = (screenX + dx) + 'px';
    el.style.top = (screenY + dy - 6) + 'px';
    el.style.transform = 'translate(-50%, -100%)';

    // Speech-bubble icon shown only when collapsed; clicking it expands.
    const icon = document.createElement('div');
    icon.className = 'pri-collapsed-icon';
    icon.title = 'Show priority note';
    icon.innerHTML =
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path class="speech-stroke" d="M4 3h16a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-7l-5 4.2A1 1 0 0 1 6.4 22V18H4a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z"/>' +
      '<path class="speech-fill" d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7.6L8.2 19V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>' +
      '</svg>';
    icon.addEventListener('pointerdown', (e) => e.stopPropagation());
    icon.addEventListener('click', (e) => {
      e.stopPropagation();
      state.priorityCollapsed[primitive.id] = false;
      renderNotes();
    });
    el.appendChild(icon);

    // Collapse "−" button shown only when expanded.
    const toggle = document.createElement('button');
    toggle.className = 'pri-toggle';
    toggle.title = 'Collapse';
    toggle.textContent = '−';
    toggle.addEventListener('pointerdown', (e) => e.stopPropagation());
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      state.priorityCollapsed[primitive.id] = true;
      renderNotes();
    });
    el.appendChild(toggle);

    const content = document.createElement('div');
    content.className = 'pri-content';
    if (primitive.name) {
      const n = document.createElement('div');
      n.className = 'pri-name';
      n.textContent = primitive.name;
      content.appendChild(n);
    }
    const body = document.createElement('div');
    body.textContent = stripUrlsFromContent(note.content || '');
    content.appendChild(body);
    el.appendChild(content);

    // Drag bubble (screen-space). Skip drag-start on the toggle / icon buttons.
    let dragSt = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.target === toggle || (icon.contains(e.target))) return;
      dragSt = { id: e.pointerId, x: e.clientX, y: e.clientY, baseDx: dx, baseDy: dy };
      el.classList.add('dragging');
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      e.stopPropagation();
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragSt || dragSt.id !== e.pointerId) return;
      const ndx = dragSt.baseDx + (e.clientX - dragSt.x);
      const ndy = dragSt.baseDy + (e.clientY - dragSt.y);
      state.priorityOffset[primitive.id] = { dx: ndx, dy: ndy };
      renderNotes();
    });
    function endDrag(e) {
      if (!dragSt || dragSt.id !== e.pointerId) return;
      dragSt = null;
      el.classList.remove('dragging');
    }
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);

    return el;
  }

  function stripUrlsFromContent(value) {
    if (!value) return '';
    const norm = value.replace(/\r\n/g, '\n');
    const sep = norm.match(/\n\n(?:https?:\/\/[^\s<>()"']+\n?)+$/);
    if (sep) return norm.slice(0, sep.index);
    if (/^(?:https?:\/\/[^\s<>()"']+\n?)+$/.test(norm)) return '';
    return norm;
  }

  function buildNoteCardEl(primitive, screenX, screenY, offset) {
    const current = getPriorityNote(primitive);
    if (!current) return null;

    const el = document.createElement('div');
    el.className = 'note-card';
    const dx = offset ? offset.dx : 14;
    const dy = offset ? offset.dy : -14;
    el.style.left = (screenX + dx) + 'px';
    el.style.top = (screenY + dy) + 'px';

    const header = document.createElement('div');
    header.className = 'note-header';
    const title = document.createElement('div');
    title.className = 'note-title';
    title.textContent = primitive.name || 'Note';
    header.appendChild(title);
    const close = document.createElement('button');
    close.className = 'note-close';
    close.textContent = '×';
    close.title = 'Close';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      state.selectedNoteId = null;
      renderNotes();
    });
    close.addEventListener('pointerdown', (e) => e.stopPropagation());
    header.appendChild(close);
    el.appendChild(header);

    if (current.name && current.name !== primitive.name) {
      const sub = document.createElement('div');
      sub.className = 'note-name';
      sub.textContent = current.name;
      el.appendChild(sub);
    }
    const body = document.createElement('div');
    body.className = 'note-body';
    body.textContent = stripUrlsFromContent(current.content || '');
    el.appendChild(body);

    // Drag card.
    let drag = null;
    header.addEventListener('pointerdown', (e) => {
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, baseDx: dx, baseDy: dy };
      header.classList.add('dragging');
      try { header.setPointerCapture(e.pointerId); } catch (_) {}
      e.stopPropagation();
    });
    header.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const ndx = drag.baseDx + (e.clientX - drag.x);
      const ndy = drag.baseDy + (e.clientY - drag.y);
      state.noteOffset[primitive.id] = { dx: ndx, dy: ndy };
      renderNotes();
    });
    function endDrag(e) {
      if (!drag || drag.id !== e.pointerId) return;
      drag = null;
      header.classList.remove('dragging');
    }
    header.addEventListener('pointerup', endDrag);
    header.addEventListener('pointercancel', endDrag);

    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => e.stopPropagation());

    return el;
  }

  function renderNotes() {
    notesLayer.innerHTML = '';
    if (!state.notesVisible) return;
    // Priority bubbles for every primitive flagged showPriorityNote.
    for (const primitive of primitives) {
      if (primitive.showPriorityNote !== true) continue;
      const note = getPriorityNote(primitive);
      if (!note) continue;
      const bounds = getBounds(primitive);
      if (!bounds) continue;
      const cx = (bounds.x + bounds.w / 2) * dims.width;
      const cy = bounds.y * dims.height;
      const screen = imageToScreen(cx, cy);
      const el = buildPriorityBubbleEl(primitive, screen.x, screen.y, state.priorityOffset[primitive.id]);
      if (el) notesLayer.appendChild(el);
    }
    // Selected note card.
    if (state.selectedNoteId) {
      const primitive = byId.get(state.selectedNoteId);
      if (primitive) {
        const bounds = getBounds(primitive);
        if (bounds) {
          const cx = (bounds.x + bounds.w) * dims.width;
          const cy = bounds.y * dims.height;
          const screen = imageToScreen(cx, cy);
          const el = buildNoteCardEl(primitive, screen.x, screen.y, state.noteOffset[primitive.id]);
          if (el) notesLayer.appendChild(el);
        }
      }
    }
  }

  function toggleNotesVisible() {
    state.notesVisible = !state.notesVisible;
    if (state.notesVisible) {
      // Reset every priority bubble to its collapsed speech-bubble state.
      for (const p of primitives) {
        if (p.showPriorityNote === true && getPriorityNote(p)) {
          state.priorityCollapsed[p.id] = true;
        }
      }
    } else {
      state.selectedNoteId = null;
    }
    refreshToolbar();
    renderNotes();
  }

  // ---------- toolbar ----------
  function refreshToolbar() {
    const btns = toolbar.querySelectorAll('button');
    btns.forEach((b) => b.classList.remove('active', 'lock-on', 'pin-on'));
    if (state.zoomLocked) toolbar.querySelector('[data-act="zoom-lock"]').classList.add('lock-on');
    if (state.panLocked) toolbar.querySelector('[data-act="pan-lock"]').classList.add('pin-on');
    if (state.occluded.size > 0) toolbar.querySelector('[data-act="occlusion"]').classList.add('active');
    if (state.showAllOverlays) toolbar.querySelector('[data-act="overlays"]').classList.add('active');
    if (state.notesVisible) toolbar.querySelector('[data-act="notes"]').classList.add('active');
    viewport.classList.toggle('pan-locked', state.panLocked);
  }

  function rectanglePrimitives() {
    return primitives.filter((p) => p.kind === 'rectangle');
  }

  function toggleOcclusionAll() {
    const rects = rectanglePrimitives();
    if (rects.length === 0) return;
    const allOccluded = rects.every((p) => state.occluded.has(p.id));
    if (allOccluded) {
      state.occluded.clear();
    } else {
      for (const p of rects) state.occluded.add(p.id);
    }
    refreshToolbar();
    renderOverlay();
  }

  function viewportCenter() {
    const r = viewport.getBoundingClientRect();
    return { x: r.width / 2, y: r.height / 2 };
  }

  toolbar.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    if (act === 'zoom-in') {
      const c = viewportCenter();
      zoomAt(c.x, c.y, 1.3);
    } else if (act === 'zoom-out') {
      const c = viewportCenter();
      zoomAt(c.x, c.y, 1 / 1.3);
    } else if (act === 'zoom-lock') {
      state.zoomLocked = !state.zoomLocked;
      refreshToolbar();
    } else if (act === 'pan-lock') {
      state.panLocked = !state.panLocked;
      refreshToolbar();
    } else if (act === 'home') {
      fit();
    } else if (act === 'occlusion') {
      toggleOcclusionAll();
    } else if (act === 'overlays') {
      state.showAllOverlays = !state.showAllOverlays;
      refreshToolbar();
      renderOverlay();
      renderNotes();
    } else if (act === 'notes') {
      toggleNotesVisible();
    }
  });

  // ---------- keys ----------
  window.addEventListener('keydown', (event) => {
    const target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    switch (event.key) {
      case '+':
      case '=': {
        const c = viewportCenter();
        zoomAt(c.x, c.y, 1.3);
        event.preventDefault();
        break;
      }
      case '-':
      case '_': {
        const c = viewportCenter();
        zoomAt(c.x, c.y, 1 / 1.3);
        event.preventDefault();
        break;
      }
      case '0':
      case 'Home':
        fit();
        event.preventDefault();
        break;
      case '9':
        state.zoomLocked = !state.zoomLocked;
        refreshToolbar();
        event.preventDefault();
        break;
      case 'p':
      case 'P':
        state.panLocked = !state.panLocked;
        refreshToolbar();
        event.preventDefault();
        break;
      case '\\':
        state.showAllOverlays = !state.showAllOverlays;
        refreshToolbar();
        renderOverlay();
        renderNotes();
        event.preventDefault();
        break;
      case 'n':
      case 'N':
        toggleNotesVisible();
        event.preventDefault();
        break;
      case 'O':
      case 'o':
        if (event.shiftKey) {
          toggleOcclusionAll();
          event.preventDefault();
        }
        break;
      case 'Escape':
        state.selectedNoteId = null;
        renderNotes();
        break;
      case 'ArrowUp':
        if (state.panLocked) break;
        state.ty -= 50; applyTransform(); event.preventDefault();
        break;
      case 'ArrowDown':
        if (state.panLocked) break;
        state.ty += 50; applyTransform(); event.preventDefault();
        break;
      case 'ArrowLeft':
        if (state.panLocked) break;
        state.tx -= 50; applyTransform(); event.preventDefault();
        break;
      case 'ArrowRight':
        if (state.panLocked) break;
        state.tx += 50; applyTransform(); event.preventDefault();
        break;
    }
  });

  // ---------- init ----------
  function start() {
    renderOverlay();
    fit();
    refreshToolbar();
    viewport.focus();
  }

  window.addEventListener('resize', () => { renderNotes(); });

  if (img.complete && img.naturalWidth > 0) start();
  else img.addEventListener('load', start, { once: true });
})();
`;
