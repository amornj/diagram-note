# Diagram Note

Diagram Note is a visual knowledge editor for studying and organizing complex diagrams, especially large biochemical and metabolic pathway maps.

It combines map viewing, overlays, annotations, grouping, search, split comparison, and cross-device sync into a single web app.

The project started from large-scale metabolic pathway study workflows and evolved into a more general diagram-note platform for scientific, educational, and visual knowledge work.

## Core idea

Diagram Note lets users:

- load large diagrams or maps
- place overlays directly on top of them
- attach structured notes and metadata
- organize concepts into ordered groups
- navigate complex systems visually
- compare regions or maps side by side
- sync maps and knowledge across devices
- build layered understanding over time

It is especially useful for:

- metabolic pathways
- biochemical subway maps
- cellular signaling pathways
- anatomical diagrams
- engineering systems
- knowledge graphs
- large educational diagrams

## Main features

### Multi-format map support

Diagram Note supports:

- PDF
- PNG
- JPG / JPEG
- WEBP

Maps render in the browser and keep their original source file for export and sync.

### Overlay-based editor

The editor supports several primitive types:

- Study box
  Small focused rectangles for specific items or concepts.
- Region
  Larger polygon overlays for pathway sections or conceptual areas.
- Polyline
  Freeform lines and shapes for route-like or structural marking.
- Group
  Ordered collections of study items.

These primitives can be layered and combined into larger study systems.

### Rich primitive metadata

Each primitive can store:

- name
- aliases
- tags
- backlinks
- notes
- color
- visibility settings

This makes the map behave more like a structured visual knowledge graph than a flat annotation layer.

### Group system

Groups are designed for ordered study collections.

Features:

- create group with shortcut `7`
- click study boxes on the map to add members
- reorder members
- show member numbers visually
- cycle members with `3` / `4`
- inherited backlinks from group to members

Group members automatically inherit backlinks to the parent group, while the group itself does not duplicate backlinks back to each member.

### Study workflow

Diagram Note is built around active visual learning.

Typical workflow:

1. See the whole pathway.
2. Focus on a region.
3. Create a study box.
4. Add notes, tags, aliases, and backlinks.
5. Organize related items into groups.
6. Navigate members with ordered focus.
7. Expand knowledge map by map over time.

### Navigation system

Shortcuts:

- `3` previous
- `4` next

Behavior:

- cycle through group members
- cycle through repeated same-name study boxes
- auto-focus the active item
- show an active red dot on the focused occurrence
- keep the right pane synced in normal mode

### Search system

Search supports:

- map name
- study boxes
- groups
- regions
- tags
- notes
- aliases

Filters include:

- `Studybox`
- `Group`
- `Region`
- `Map`
- `All map`

`All map` searches across all available maps and shows the parent map name in results.

### Split screen mode

Shortcut:

- `B`

Split screen supports:

- comparing different regions of the same map
- comparing different pages of the same PDF
- comparing two different maps

Current behavior:

- each window has its own map picker
- each window has its own overlay toggle
- each window has its own zoom lock and pin state
- split mode is view-oriented, not editing-oriented

### Text extraction workflow

Shortcut:

- `T`

Text mode allows selecting text directly from PDF-based maps.

This is useful for quickly reading labels and creating study boxes from map content.

### View control tools

Key controls include:

- `9` zoom lock
  Prevents wheel zoom, `+/-` zoom, and auto-zoom on focus.
- `P` pin
  Freezes map position so focus changes do not pan the map.
- `0` / `Home`
  Reset view.
- `\`
  Toggle overlay visibility.

### Cross-platform input support

Diagram Note is a web app and supports:

- keyboard
- mouse
- touch-capable browser interaction

## Synchronization and storage

### Firebase sync

When Firebase is configured, Diagram Note syncs:

- maps
- source files
- overlays
- notes
- metadata

This allows cross-device access through Google sign-in.

### `.dnote` format

`.dnote` is the native portable file format.

It bundles:

- map metadata
- original source file
- workspace JSON
- overlay data

Use cases:

- backup
- offline transfer
- portability
- sharing

### Import / export

Supported import/export paths:

- `.dnote`
- workspace JSON
- Markdown export for notes

Notes from the active map can also export to Markdown.

## Hotkeys

| Key | Action |
|---|---|
| `1` | Toggle left pane |
| `2` | Toggle right pane |
| `3` / `4` | Previous / next focus |
| `5` | Search |
| `6` | New study box |
| `7` | Group builder |
| `8` | New polyline / shape |
| `9` | Zoom lock |
| `P` | Pin viewport |
| `0` / `Home` | Reset view |
| `T` | Text mode |
| `M` | Map picker |
| `B` | Split compare |
| `\` | Toggle overlays |
| `/` | Focus search |
| `?` | Hotkey help |
| `Esc` | Close / cancel current mode |

## Run locally

```bash
npm install
npm run dev
npm run build
```

Default local dev URL:

- `http://localhost:5173`

## Optional Firebase setup

Copy `.env.example` to `.env.local` and fill in Firebase credentials:

```bash
cp .env.example .env.local
```

Without Firebase credentials, Diagram Note still runs fully offline with IndexedDB persistence.

## Persistence

All maps are stored in the browser's IndexedDB.

The app stores:

- map metadata
- source files
- generated rasters
- workspaces

When Firebase is enabled:

- map metadata syncs through Firestore
- source files sync through Cloud Storage
- the app merges local and cloud state automatically

## Design philosophy

Diagram Note is designed for:

- biochemistry students
- medical students
- scientific researchers
- visual learners
- large-scale knowledge organization

The goal is to help users:

- see the whole picture
- focus deeply on details
- build structured understanding
- maintain long-term visual knowledge

## Key strengths

- handles very large maps
- visual-first learning workflow
- structured knowledge organization
- overlay-driven study system
- cross-device sync
- rich metadata and linking
- pathway-scale thinking support

## Example use cases

### Biochemistry

- glycolysis
- TCA cycle
- urea cycle
- electron transport chain
- metabolic integration

### Medicine

- anatomical systems
- clinical diagrams
- pathway-oriented study maps

### Education

- study collections
- concept linking
- large visual notes

### Engineering

- complex system diagrams
- infrastructure mapping
- network visualization

## File format details

A `.dnote` archive contains:

- `manifest.json`
- `map.file`
- `workspace.json`

Legacy `map.pdf` entries still import for backward compatibility.

## Notes

- The bundled default map ships in `public/metabolic-map.pdf`.
- The original source file is preserved with each imported map.
- Multi-page PDFs keep per-page overlay state.
- Cross-page backlinks are supported.
- Notes and overlays are meant to build incrementally over time.

## Architecture

See [HANDOFF.md](HANDOFF.md) for implementation notes, design decisions, and extension guidance.

## License

MIT
