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
}

export type PrimitiveKind = 'rectangle' | 'polygon' | 'customline' | 'group';

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

export interface DiagramMap {
  id: string;
  name: string;
  pdfHash: string;
  pageIndex: number;
  sourceWidth: number;
  sourceHeight: number;
  renderScale: number;
  workspace: MapWorkspace;
  createdAt: number;
  updatedAt: number;
}

export interface DnoteManifest {
  format: 'dnote';
  version: 1;
  map: Omit<DiagramMap, 'workspace'>;
}
