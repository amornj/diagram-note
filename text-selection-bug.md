# Text Selection Bug — RESOLVED

## Root cause

PDF.js v4 changed how `TextLayer` sizes its container. Each text span is now
positioned with **percentages** (e.g. `left: 86.73%; top: 62.01%`) inside a
container whose width and height come from CSS expressions that reference a
custom property:

```
width:  round(down, var(--scale-factor) * 4836px, var(--scale-round-x, 1px));
height: round(down, var(--scale-factor) * 2412px, var(--scale-round-y, 1px));
font-size: calc(var(--scale-factor) * 14.97px);
```

Our `TextLayer.tsx` never set `--scale-factor`. The `var()` calls evaluated to
the invalid-value fallback, so width/height fell back to `auto`. With
`position: absolute; inset: 0`, the container then stretched to fill the
parent (~1369 × 1334 px) — completely unrelated to the PDF page geometry.

The percentage-positioned spans landed wherever in that stretched box, so they
**never aligned with the visible text in the rasterized image**. The cursor
showed as a text-beam (set on the container itself), but every drag was over
empty space — there were no spans under the pointer to start a selection on.

## Fix

In `src/components/TextLayer.tsx`:

- Set `container.style.setProperty('--scale-factor', String(cssScale))` in the
  viewport-sync effect, where `cssScale = (tr.x − tl.x) / pageSize.w`.
- Drop `scale(...)` from the CSS transform — only use `translate(tl.x, tl.y)`.
  PDF.js's own size/font calculations now resolve to the correct on-screen
  pixel dimensions through `--scale-factor`.
- Remove the manual `container.style.width/height` assignment — PDF.js's
  `render()` overwrites them with the calc()-based expressions anyway.

In `src/index.css`:

- Remove `inset: 0` from `.pdf-text-layer`. With `--scale-factor` now defined,
  the calc()-based width/height work correctly; `inset: 0` was the override
  that masked the real bug.

## Verified

Press T → drag over visible text → text is selected and copyable. Tested at
multiple zoom levels (default, +3 zoom). Drag-select on a span with text
"Oxidative phosphorylation" returned the expected substring.

## Note on UX

At default zoom for a 4836 × 2412 px PDF (the bundled metabolic map), each
text glyph is only ~4 px tall — readable but very hard to drag-select.
Zoom in (`+`) before selecting; the text layer scales with the rasterized
image, so spans grow and become easy targets.
