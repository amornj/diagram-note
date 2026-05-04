# diagram-note

Drop a PDF diagram, draw study primitives on top, attach notes/tags/aliases, export the whole bundle as a portable file. Re-import on another machine and keep working.

## What it does

1. **Upload a PDF** — any complex diagram. Renders client-side via pdf.js.
2. **Draw primitives on top** — study boxes (rectangles), polylines, regions (polygons), and groups.
3. **Edit each primitive** — name, aliases, tags, notes, color, backlinks.
4. **Switch maps** — multiple PDFs coexist; overlays follow the active map.
5. **Export / import** — single `.dnote` bundle (PDF + workspace) or workspace JSON only.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build → dist/
```

## Hotkeys

| Key | Action |
|---|---|
| `1` | Toggle left pane |
| `2` | Toggle right pane |
| `3` / `4` | Cycle group members |
| `5` | Search |
| `6` | New study box (rectangle) |
| `7` | Group builder |
| `8` | New polyline / region |
| `9` | Lock zoom |
| `0` / `Home` | Reset view |
| `+` `-` `wheel` | Zoom |
| `Space` + drag | Pan |
| `/` | Focus search |
| `Esc` | Cancel current draw / close popup |

## File format: `.dnote`

A `.dnote` is a zip archive with three entries:

- `manifest.json` — `{ format: "dnote", version: 1, map: { id, name, pdfHash, pageIndex, sourceWidth, sourceHeight, renderScale, createdAt, updatedAt } }`
- `map.pdf` — original PDF bytes
- `workspace.json` — `MapWorkspace` (primitives + their notes/tags/aliases)

Round-trippable: export → import → identical state (`updatedAt` aside).

## Persistence

All maps live in the browser's IndexedDB (`diagram-note` database). Workspace edits debounce-save to the active map every 200 ms. Use **Export .dnote** before clearing your browser data.

## Architecture

See [HANDOFF.md](HANDOFF.md) for the phased build plan, design decisions, and where to extend.
