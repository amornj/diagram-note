# diagram-note

Diagram overlay editor for PDFs and images. Draw study primitives on top, attach notes / tags / aliases / backlinks, and export the whole bundle as a portable `.dnote`. Works entirely in the browser — optionally sync across devices via Google sign-in.

## What it does

1. **Starts in the editor immediately** — first launch seeds a bundled subway map so you never land on an empty page.
2. **Load maps from PDF, PNG, JPEG, or WEBP** — renders client-side and stores the original source file with the map. Pick render quality (1× / 2× / 3×) on import.
3. **Multi-page PDFs** — page picker keeps per-page overlays; backlinks can point across pages.
4. **Draw primitives on top** — study boxes (rectangles), polylines, regions (polygons), and groups.
5. **Edit each primitive** — name, aliases, tags, notes, color, visibility, group membership, and backlinks.
6. **Use multiple maps** — rename, reorder, switch, and delete maps from the left pane.
7. **Search everything** — fuzzy search across names, aliases, tags, and note contents.
8. **Export / import** — single `.dnote` bundle (source file + workspace) or workspace JSON only.
9. **Optional cloud sync** — sign in with Google to back up maps and source files to Firebase; edits sync across devices automatically.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build → dist/
```

## Optional: Firebase setup

Copy `.env.example` to `.env.local` and fill in your Firebase project credentials to enable cloud sync:

```bash
cp .env.example .env.local
```

Without Firebase credentials the app runs fully offline with IndexedDB persistence.

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
| `+` `−` `wheel` | Zoom |
| `Space` + drag | Pan |
| `/` | Focus search |
| `?` | Hotkey help |
| `Esc` | Cancel current draw / close popup |

## File format: `.dnote`

A `.dnote` is a zip archive with three entries:

- `manifest.json` — map metadata including active page, render scale, source type, and timestamps
- `map.file` — original source file bytes (`.pdf`, `.png`, `.jpg`, etc.)
- `workspace.json` — per-page `MapWorkspace` data

Legacy `map.pdf` entries still import for backward compatibility.

## Persistence

All maps live in the browser's IndexedDB (`diagram-note` database). Workspace edits debounce-save to the active map every 200 ms. Use **Export .dnote** before clearing your browser data.

When Firebase is configured, map metadata syncs to Firestore and source files upload to Cloud Storage. The app merges cloud and local state automatically (newer `updatedAt` wins).

## Notes

- The bundled default subway map ships in `public/metabolic-map.pdf`.
- The original source file is stored with each map, so re-exported `.dnote` files preserve the imported PDF/image.
- Cross-page backlinks are supported for multipage PDFs.
- Safari historically quirked on Blob storage in IndexedDB; the app falls back to `ArrayBuffer` when needed.

## Architecture

See [HANDOFF.md](HANDOFF.md) for the phased build plan, design decisions, and where to extend.

## License

MIT
