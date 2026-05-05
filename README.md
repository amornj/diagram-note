# diagram-note

Diagram overlay editor for PDFs and images. Draw study primitives on top, attach notes/tags/aliases/backlinks, and export the whole bundle as a portable `.dnote`.

## What it does

1. **Starts in the editor immediately** — first launch seeds a bundled `FullSubwayMap_V1023_Web.pdf` so you do not land on an empty front page.
2. **Load maps from PDF, PNG, or JPEG** — renders client-side and stores the original source file with the map.
3. **Draw primitives on top** — study boxes (rectangles), polylines, regions (polygons), and groups.
4. **Edit each primitive** — name, aliases, tags, notes, color, visibility, group membership, and backlinks.
5. **Use multiple maps** — rename, reorder, switch, and delete maps from the left pane.
6. **Work across PDF pages** — multipage PDFs keep per-page overlays, and backlinks can point across pages.
7. **Export / import** — single `.dnote` bundle (source file + workspace) or workspace JSON only.

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
| `8` | New polyline / shape |
| `9` | Lock zoom |
| `0` / `Home` | Reset view |
| `+` `-` `wheel` | Zoom |
| `Space` + drag | Pan |
| `/` | Focus search |
| `Esc` | Cancel current draw / close popup |

## File format: `.dnote`

A `.dnote` is a zip archive with three entries:

- `manifest.json` — map metadata including active page, render scale, source type, and timestamps
- `map.file` — original source file bytes (`.pdf`, `.png`, `.jpg`, etc.)
- `workspace.json` — per-page `MapWorkspace` data

Legacy `map.pdf` entries still import for backward compatibility.

## Persistence

All maps live in the browser's IndexedDB (`diagram-note` database). Workspace edits debounce-save to the active map every 200 ms. Use **Export .dnote** before clearing your browser data.

## Notes

- The bundled default subway map ships in `public/FullSubwayMap_V1023_Web.pdf`.
- The original source file is stored with each map, so re-exported `.dnote` files preserve the imported PDF/image.
- Cross-page backlinks are supported for multipage PDFs.

## Architecture

See [HANDOFF.md](HANDOFF.md) for the phased build plan, design decisions, and where to extend.
