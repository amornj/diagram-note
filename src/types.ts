export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface NoteCard {
  name: string;
  content: string;
  isPriority?: boolean;
}

export type PrimitiveKind = 'rectangle' | 'polygon' | 'customline' | 'group';

export interface Primitive {
  id: string;
  kind: PrimitiveKind;
  name: string;
  color: string;
  createdAt?: number;
  updatedAt?: number;
  aliases?: string[];
  tags?: string[];
  notes?: NoteCard[];
  showLabel?: boolean;
  showOnLoad?: boolean;
  showPriorityNote?: boolean;
  priorityNoteCollapsed?: boolean;
  priorityNoteAnchor?: Point;
  priorityNoteOffset?: Point;
  /** rectangle */
  bbox?: BBox;
  /** polygon, customline */
  points?: Point[];
  /** group */
  groupMemberKeys?: string[];
  showMemberNumbers?: boolean;
  /** any-to-any backlinks (single namespace: 'primitive:<id>') */
  relatedMemberKeys?: string[];
}

export interface MapWorkspace {
  version: 1;
  primitives: Primitive[];
}

export interface PageMeta {
  workspace: MapWorkspace;
  sourceWidth: number;
  sourceHeight: number;
}

export interface DiagramMap {
  id: string;
  name: string;
  pdfHash: string;
  sourceType?: 'pdf' | 'image';
  sourceName?: string;
  sourceMimeType?: string;
  sourceStoragePath?: string;
  sortOrder?: number;
  /** Currently-active page index (0-based). */
  pageIndex: number;
  /** Total number of pages in the source PDF. */
  pageCount: number;
  /** Active page's raster width — denormalised for convenience. */
  sourceWidth: number;
  sourceHeight: number;
  renderScale: number;
  /** Active page's workspace — denormalised so v1 readers still work. */
  workspace: MapWorkspace;
  /** Per-page workspace + dims. Includes the active page. Optional for v1 compat. */
  pages?: Record<number, PageMeta>;
  /** Marks the built-in default map — renameable but not deletable. */
  isDefault?: boolean;
  /** Last time the user opened this map in the editor. */
  lastOpenedAt?: number;
  /** Soft-delete marker; archived maps stay recoverable until permanently deleted. */
  archivedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface DnoteManifest {
  format: 'dnote';
  version: 1;
  /** Map metadata sans per-page contents (those live in workspace.json). */
  map: Omit<DiagramMap, 'workspace' | 'pages'>;
}
