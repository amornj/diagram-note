# diagram-note — Agent Handoff

Living document. Each agent: read top-to-bottom before starting, append a "Phase N — completed" entry at the bottom on finish, leave gotchas the next agent needs.

Repo: https://github.com/amornj/diagram-note (origin set; no commits pushed yet).
Source editor reference: `../metabolic-map/` (read-only — port code from here, do not modify it).

---

## Vision

A generic PDF-overlay editor. Drop in any complex diagram (PDF), draw study primitives on top, attach notes/tags/aliases, export the whole bundle (PDF + overlays + notes) as a single portable file. Re-import on another machine and keep working.

Three layers:

1. **Map layer** — user-supplied PDF, rendered via OpenSeadragon.
2. **Editor layer** — primitives (study box, polyline/shape, group), hotkeys, search, right-pane editor. **Ported from metabolic-map.**
3. **Content layer** — user-generated overlays + notes, persisted per map, exportable to JSON or to a single PDF+JSON bundle (`.dnote`).

---

## Hard rules

- **No domain data shipped.** Strip every metabolite, reaction, pathway, connector, region, compartment, domain, quiz, membrane, trace artifact from the metabolic-map port. The editor must be content-agnostic.
- **Editor primitives own their own data.** In metabolic-map, study boxes auto-link to a built-in metabolite ID and write into a separate `annotations` dictionary keyed by that metabolite. Here, every primitive holds its own `name`, `aliases`, `tags`, `notes`, `color`, `relatedMemberKeys` directly. Drop the `annotations` dictionary entirely.
- **Per-map workspace.** Each loaded map gets its own workspace blob — overlays/notes follow the active map.
- **Static-host friendly.** No server. All ingestion, rendering, and persistence happens in the browser (Vercel deploy parity with metabolic-map).
- **Reversible imports.** A `.dnote` file is round-trippable: export → import → byte-equivalent state.

---

## Architecture

```
diagram-note/
├── HANDOFF.md
├── README.md
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── public/                       — empty; no shipped map assets
└── src/
    ├── main.tsx
    ├── App.tsx                   — top shell: routes between landing (no map) / editor (active map)
    ├── index.css                 — Tailwind entry
    ├── types.ts                  — generic Primitive / MapWorkspace / DiagramMap types
    ├── lib/
    │   ├── store.ts              — Zustand: editor state for the ACTIVE map
    │   ├── mapStore.ts           — Zustand: list of loaded maps + activeMapId
    │   ├── workspace.ts          — workspace serialisation, merge, helpers
    │   ├── coords.ts             — bbox<->viewport (sourceWidth/Height read from active map, not constants)
    │   ├── pdf.ts                — pdfjs render → raster Blob (NEW)
    │   ├── bundle.ts             — .dnote zip pack/unpack via fflate (NEW)
    │   └── idb.ts                — IndexedDB wrapper for maps + PDFs + rasters (NEW)
    ├── hooks/
    │   └── useUrlState.ts        — selection only; drop trace state
    └── components/
        ├── Editor.tsx            — replaces MetabolicMap.tsx (PDF-agnostic)
        ├── HotspotLayer.tsx      — kept; renders user primitives only
        ├── OverlayDetailPanel.tsx— right pane (rename/alias/tag/note/backlink/color/hide)
        ├── SearchBox.tsx         — searches user primitives only
        ├── StudyWorkspace.tsx    — kept; trimmed of metabolite branches
        ├── LeftPane.tsx          — primitive list + tag filter + map switcher (replaces DomainFilters)
        ├── MapPicker.tsx         — list/switch/delete loaded maps (NEW)
        ├── Landing.tsx           — drag-drop / pick PDF / pick .dnote (NEW)
        └── ImportExportBar.tsx   — load PDF / load .dnote / export workspace.json / export .dnote
```

### Data model (replaces `src/types.ts` from metabolic-map)

```ts
export type PrimitiveKind = 'rectangle' | 'polygon' | 'customline' | 'group';

export interface BBox { x: number; y: number; w: number; h: number; }   // normalized 0..1
export interface Point { x: number; y: number; }                        // normalized 0..1
export interface NoteCard { name: string; content: string; }

export interface Primitive {
  id: string;
  kind: PrimitiveKind;
  name: string;
  color: string;
  aliases?: string[];
  tags?: string[];
  notes?: NoteCard[];
  showLabel?: boolean;
  showOnLoad?: boolean;
  // geometry
  bbox?: BBox;                                  // rectangle
  points?: Point[];                             // polygon, customline
  // group
  groupMemberKeys?: string[];                   // 'primitive:<id>' refs only
  showMemberNumbers?: boolean;
  // any-to-any backlinks
  relatedMemberKeys?: string[];                 // 'primitive:<id>' refs only
}

export interface MapWorkspace {
  version: 1;
  primitives: Primitive[];
}

export interface DiagramMap {
  id: string;                  // uuid
  name: string;                // user-editable
  pdfHash: string;             // sha256 of pdf bytes — binds workspace to PDF
  pageIndex: number;           // 0-based
  sourceWidth: number;         // px from rendered raster
  sourceHeight: number;
  renderScale: number;         // pdfjs scale used (1, 2, 3)
  workspace: MapWorkspace;
  createdAt: number;
  updatedAt: number;
}
```

Group `memberKey` and related `memberKey` use a single namespace: `primitive:<id>`. The `metabolite:` prefix from metabolic-map disappears.

### `.dnote` bundle format

Zip archive (`.dnote` extension). Build/parse with `fflate`.

```
<file>.dnote/
├── manifest.json   {"format":"dnote","version":1,"map":{...DiagramMap minus workspace...}}
├── map.pdf         binary
└── workspace.json  MapWorkspace
```

Versioning: `manifest.format === "dnote"` and `manifest.version === 1` checked on import. Mismatch = explicit error toast.

Round-trip guarantee: export of a fresh import produces identical `manifest.json` + `workspace.json` byte-for-byte (modulo `updatedAt`).

### Multi-map storage (IndexedDB)

Three object stores in a single DB `diagram-note`:

- `maps` — keyPath `id`, value `DiagramMap` (workspace included).
- `pdfs` — keyPath `mapId`, value `{ mapId, blob: Blob }`.
- `rasters` — compound key `[mapId, scale]`, value `{ mapId, scale, blob: Blob, width, height }`.

`activeMapId` lives in `localStorage` (small, synchronous read on boot).

Workspace persistence: `store.ts` debounces (200 ms) writes to `maps[activeMapId].workspace`.

### PDF ingestion (Phase 2 baseline — single-page raster)

1. User picks PDF (file input / drag-drop / `.dnote` import).
2. Compute sha256 → `pdfHash`. Check `maps` for existing record with same hash; if found, switch to it instead of duplicating.
3. Run `pdfjs-dist` to load the PDF, get page 0.
4. Render to an offscreen canvas at `scale = 2` (default); user can pick 1/2/3 on the import dialog. Canvas dimensions become `sourceWidth/sourceHeight`.
5. `canvas.convertToBlob({ type: 'image/png' })` → store in `rasters` IDB store.
6. Create OSD viewer with `tileSources: { type: 'image', url: URL.createObjectURL(blob) }`. OSD's image tile source handles its own pyramidization in-browser.
7. Free the object URL on viewer destroy.

**Why single-image not pdf.js per-tile (yet):** a 2× rendered poster (~4000 × 2000 px) is well under 10 MB PNG and OSD's image source handles pan/zoom smoothly. True per-tile pdf.js rendering goes to Phase 7 (stretch) only if real-world PDFs exceed this comfortably.

**Cache:** raster Blob cached by `(mapId, scale)`; subsequent opens of the same map skip rendering.

### Coupling to strip when porting (do NOT bring these across)

Files to **NOT** copy:
- `src/data/**` (everything: metabolites.json, reactions.json, pathways.json, connectors.json, regions.json, compartment-bands.json, contentNotes.ts, allMetabolites.ts, defaultWorkspace.ts, domains/, raw/)
- `src/components/DomainFilters.tsx`
- `src/components/MembraneOverlay.tsx`
- `src/components/QuizPanel.tsx`
- `src/components/DetailPanel.tsx`, `detailPanelShared.tsx` (metabolite-specific)
- `scripts/build-connectors.ts`, `build-reactions.ts`, `validate-graph.ts`, `extract-bboxes.ts`, `curate-phase3.ts`, `bake-workspace.ts`, `validate-data.ts`
- `scripts/build-tiles.sh` (PDF-to-DZI server pipeline; we render in-browser instead)
- `public/map/`, `FullSubwayMap_V1023_Web.pdf`, `KIMI.md`, `LICENSE` (metabolic-map's CC license is map-specific — pick our own)

Code branches inside copied files to **delete**:
- `store.ts` — `findLinkedMetaboliteId`, `buildLinkedRectangleOverlay`, all annotation mutators (`updateAnnotationNotes`, `Tags`, `Aliases`, `Kind`, `Color`, `Hidden`, `NameOverride`, `saveBBoxOverride`), `metaboliteNeighborTargetId` flow, quiz mutators (`dismissQuizQuestion`, `addCustomQuizQuestion`, `deleteCustomQuizQuestion`), `showMembranes`/`toggleMembranes`. Replace `MetaboliteAnnotation`-keyed paths with primitive mutators.
- `cycleSelection` — drop the metabolite branch; keep only group-member cycling (now between primitive members).
- `confirmDraftStudyBox` — drop the `linkedMetaboliteId` write into `annotations`. Study-box edits write only the primitive's own fields.
- `OverlayDetailPanel` — kept; trim any "linked metabolite" sections.
- `SearchBox` — drop metabolite/reaction search; index only `workspace.primitives`.
- `useUrlState` — drop trace `from`/`to`/`step` params; keep only `selectedPrimitiveId` (and `mapId`).
- `coords.ts` — replace module constants `SOURCE_WIDTH`/`SOURCE_HEIGHT` with values read from the active `DiagramMap`. Easiest: take them as args, or expose a `useSourceDims()` hook reading from `mapStore`.

Hotkey re-mapping (the ones tied to dropped features):
- `9` lock zoom — **keep**.
- Any hotkey tied to membrane / domain filters / quiz / trace — **drop**.
- Hotkeys 1–8 (panes, prev/next, search, new study box, group, polyline) — **keep**.

---

## Phased build plan

Status legend: ⬜ not started · 🟡 in progress · ✅ done

| Phase | Outcome | Status |
|-------|---------|--------|
| 0 | Scaffold + remote ready | ⬜ |
| 1 | Generic types + per-map workspace store | ⬜ |
| 2 | PDF → in-browser raster → OSD viewer | ⬜ |
| 3 | Editor port (primitives, panes, hotkeys, search) | ⬜ |
| 4 | Multi-map model + IndexedDB persistence | ⬜ |
| 5 | `.dnote` bundle import/export | ⬜ |
| 6 | UX polish (drag-drop landing, hotkey help, README) | ⬜ |
| 7 | Stretch: pdf.js tile pyramid + multi-page nav | ⬜ |

### Phase 0 — Scaffold + remote ready

Goal: empty Vite + React + TS + Tailwind app, builds and serves "Hello diagram-note", origin pushed.

1. `cd /Users/home/projects/diagram-note`
2. Copy these files **verbatim** from `../metabolic-map/`: `package.json` (rename `metabolic-map` → `diagram-note` and trim scripts to dev/build/lint/preview only), `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `vite.config.ts`, `eslint.config.js`, `index.html`, `.gitignore`.
3. Trim `package.json` dependencies to just: `react`, `react-dom`, `react-router-dom` (only if we keep routing — current shell doesn't need it; can drop), `zustand`, `openseadragon`, `lucide-react`. devDeps: same as metabolic-map. Add `pdfjs-dist` and `fflate` (Phase 2/5).
4. `src/main.tsx`, `src/index.css`, `src/App.tsx` with a placeholder "diagram-note" page.
5. `npm install` → `npm run dev` → confirm 200 OK at `http://localhost:5173`.
6. **Confirm with user before pushing:** initial commit + `git push -u origin main`. Do not push without explicit OK.

Acceptance: `npm run build` succeeds. `npm run dev` shows placeholder.

### Phase 1 — Types + per-map workspace store

Goal: data model defined; store can hold/mutate primitives for one map; no PDF yet.

1. Write `src/types.ts` with the data model above. **No** Domain/Compartment/Reaction/Pathway/Metabolite types.
2. Write `src/lib/workspace.ts`:
   - `EMPTY_WORKSPACE: MapWorkspace`
   - `addPrimitive`, `updatePrimitive`, `deletePrimitive` (pure functions on a workspace)
   - `getPrimitiveById`, `getRelatedKeys`, `getGroupMemberKeys`
   - `bboxFromPoints`, `boundsFromPrimitive`
   - `parseMemberKey` / `makeMemberKey` (single namespace `primitive:<id>`)
3. Write `src/lib/store.ts` (Zustand) — port from metabolic-map's `store.ts` with the deletions listed above. Single `workspace` field; on every mutation, call out to a debounced persister (Phase 4 wires it to IDB; for now just `console.log`).
4. Smoke test: render a `<pre>{JSON.stringify(workspace,null,2)}</pre>` on the page, add a button that calls `addPrimitive`, verify state updates.

Acceptance: type-check passes; primitive mutations work in the browser.

### Phase 2 — PDF → raster → OSD

Goal: pick a PDF in the UI, see it rendered with pan/zoom.

1. `npm i pdfjs-dist`. Configure pdfjs worker via Vite (`?url` import pattern — see pdfjs-dist v4 README).
2. Write `src/lib/pdf.ts`:
   ```ts
   export async function rasterizePdf(file: File, opts: { scale: number; pageIndex?: number }): Promise<{ blob: Blob; width: number; height: number; hash: string; }>
   ```
   - Compute sha256 of file bytes via `crypto.subtle.digest`.
   - Load PDF, render the requested page to an offscreen canvas at `scale`.
   - Convert to PNG Blob.
3. Write `src/components/Editor.tsx` — port `MetabolicMap.tsx` with these changes:
   - `tileSources` becomes `{ type: 'image', url }` where `url` is the object URL of the rasterized blob.
   - `SOURCE_WIDTH`/`SOURCE_HEIGHT` come from props/store, not constants.
   - Drop membrane overlay button; drop trace UI; drop Stanford-specific copy.
4. Write `src/components/Landing.tsx` — drop area + file picker; on PDF select, run `rasterizePdf` and route to editor with the resulting raster.
5. Acceptance: pick a PDF, see it rendered in OSD, pan/zoom works, scroll-wheel zooms, hotkeys 1/2 (panes) toggle empty stubs.

### Phase 3 — Editor port

Goal: full primitive lifecycle on top of a rendered PDF, with right-pane editor and search.

1. Copy `HotspotLayer.tsx` → strip every reference to metabolites, domains, hover/click on built-in hotspots. Keep:
   - polygon/customline/rectangle/group draw + render
   - drag/drop, draft preview, finalize on release
   - selection box + dashed selected-overlay style
   - the bug-fix notes from metabolic-map's `HANDOFF.md` "(Resolved)" section (apply them — drawing-mode-stuck fix, name-input autofocus, label rendering on rectangles).
2. Copy `OverlayDetailPanel.tsx` → trim metabolite link section. Keep: name, aliases, tags, notes, color picker, hide, related-key picker, group-member reorder.
3. Copy `SearchBox.tsx` → search index built from `workspace.primitives` only; field set: `name`, `aliases`, `tags`, `notes[].content`. Drop pathway/reaction/domain filters. Keep keyboard shortcuts (`/`, arrows, `Enter`, `Esc`).
4. Copy `StudyWorkspace.tsx` → drop the metabolite-kind buttons in the study-box draft editor (or keep `kind` as a free-form tag — defer; safest to drop).
5. Write `LeftPane.tsx` from scratch — primitive list grouped by kind, tag filter chips computed from existing primitive tags, click-to-select, hover-to-highlight.
6. Wire all pane resize/collapse logic from `App.tsx`.
7. Acceptance: load PDF → press `6` → drag rectangle → primitive appears, right pane opens with name input focused → type name, add tags, add a note → reload page (with Phase 4 done; for now just check in-memory works) → primitive persists.

### Phase 4 — Multi-map model + IndexedDB

Goal: multiple maps coexist; switching swaps PDF + workspace.

1. Write `src/lib/idb.ts` — thin wrapper over native IndexedDB (no library). Object stores: `maps`, `pdfs`, `rasters`. API:
   ```ts
   listMaps(): Promise<DiagramMap[]>
   getMap(id): Promise<DiagramMap | null>
   putMap(map): Promise<void>
   deleteMap(id): Promise<void>
   getPdfBlob(mapId): Promise<Blob | null>
   putPdfBlob(mapId, blob): Promise<void>
   getRaster(mapId, scale): Promise<{blob: Blob; width: number; height: number} | null>
   putRaster(mapId, scale, raster): Promise<void>
   ```
2. Write `src/lib/mapStore.ts` (Zustand) — `maps: DiagramMap[]`, `activeMapId: string | null`, `loadMaps()`, `setActiveMap(id)`, `createMapFromPdf(file)`, `deleteMap(id)`, `renameMap(id, name)`.
3. Hook `lib/store.ts` workspace persister to `idb.putMap` for the current `activeMapId`. Debounce 200 ms.
4. On boot: `mapStore.loadMaps()` → if `activeMapId` in localStorage exists, restore active map's raster from IDB and open editor; else show Landing.
5. Write `MapPicker.tsx` — list of maps with rename + delete + active indicator. Mount in left pane top section.
6. Acceptance: import PDF A, draw on it, import PDF B (Landing or "+ New map"), switch back to A, primitives reappear. Refresh browser → state intact.

### Phase 5 — `.dnote` bundle

Goal: export an active map as `.dnote`, import a `.dnote` to recreate it.

1. `npm i fflate`.
2. Write `src/lib/bundle.ts`:
   ```ts
   export async function exportDnote(map: DiagramMap, pdfBlob: Blob): Promise<Blob>
   export async function importDnote(file: File): Promise<{ map: DiagramMap; pdfBlob: Blob }>
   ```
   - Export: `fflate.zip({...})` over `manifest.json`, `map.pdf`, `workspace.json`. Wrap result Uint8Array in a Blob with type `application/zip`. Save as `<map.name>.dnote`.
   - Import: `fflate.unzip(...)`. Validate `manifest.format === 'dnote'` and `version === 1`. Reject otherwise.
3. Add buttons to `ImportExportBar.tsx`:
   - **Load PDF** (new map from PDF only)
   - **Load .dnote** (new map from bundle)
   - **Export workspace.json** (current map's `MapWorkspace` only)
   - **Export .dnote** (current map's PDF + workspace bundle)
4. Round-trip test: export → delete map → import the exported file → verify all primitives + names + notes restored.
5. Acceptance: hand-off scenario from the brief works — export `.dnote` on machine A, open on machine B, the editor reproduces every overlay and note over the same PDF.

### Phase 6 — UX polish

1. Drag-drop PDF / `.dnote` anywhere on the page (Landing AND Editor) routes through the right loader.
2. Hotkey help overlay on `?`.
3. README with: what the app does, how to run dev, how to import/export, key shortcuts, `.dnote` format spec.
4. Empty-state copy on Landing.
5. Apply the three "(Resolved)" bug fixes from metabolic-map's HANDOFF (drawing-mode-stuck, name-input autofocus on new study boxes, on-map label rendering for rectangles) if not already absorbed in Phase 3.
6. License pick (MIT or similar) — metabolic-map's CC-NC-SA was poster-specific; this app ships no third-party content.

### Phase 7 — Stretch (only if a real PDF exposes a problem)

- Per-tile pdf.js rendering via OSD `CanvasTileSource` for very large maps (≫ 4000 px).
- Multi-page PDF navigation (page picker, page-keyed workspace per `DiagramMap`).
- Markdown export of all notes for one map.
- Cross-map global search (search every loaded map's primitives).

---

## Success criteria (from the brief)

1. ✅ Upload PDF to app, start creating overlays + notes.
2. ✅ Switch to a different map; overlays/notes track the active map.
3. ✅ Export a single JSON (`.dnote`) bundle that contains map PDF + user content; import recreates the editor state exactly.

---

## Open questions to confirm with the user before Phase 5

- File extension: `.dnote` or `.diagramnote` or just `.zip`? (Default: `.dnote`.)
- Multi-page PDFs in v1: just page 0, or expose page picker? (Default: page 0; multi-page goes to Phase 7.)
- Preferred render scale default: 1×, 2×, 3×? (Default: 2× — auto-bumped to 3× if natural width < 2000 px.)

---

## Notes for the next agent

- The metabolic-map `HANDOFF.md` "(Resolved) New-study-box flow" section documents three bugs that were live in the editor at the time of porting; carry the fixes across in Phase 3 (do not re-introduce the regressions).
- pdfjs-dist v4 ships an ESM worker; the conventional Vite import is `import 'pdfjs-dist/build/pdf.worker.min.mjs?url'`. Confirm against the version installed.
- IndexedDB on Safari has historical quirks with Blob storage; if rasters fail to round-trip in iOS Safari, fall back to `ArrayBuffer` storage and re-wrap on read.
- OSD's image tile source loads the entire image upfront — on very large rasters (≥ 8000 × 8000 px) memory pressure becomes real. That is the trigger for Phase 7.
- Origin remote is set but **nothing pushed** as of Phase 0. Confirm with user before the first push.
