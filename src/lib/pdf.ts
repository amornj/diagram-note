import * as pdfjsLib from 'pdfjs-dist';
// pdfjs v4 ships an ESM worker. Vite resolves the worker URL via ?url
// and we hand it to pdfjs.GlobalWorkerOptions.workerSrc.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export interface RasterizeResult {
  blob: Blob;
  width: number;
  height: number;
  hash: string;
  pageCount: number;
}

export type SourceType = 'pdf' | 'image';

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function rasterizePdf(
  source: File | Blob | ArrayBuffer,
  opts: { scale: number; pageIndex?: number }
): Promise<RasterizeResult> {
  const buf =
    source instanceof ArrayBuffer
      ? source
      : await source.arrayBuffer();
  const hash = await sha256Hex(buf);

  // pdfjs mutates the buffer; pass a copy.
  const data = new Uint8Array(buf.slice(0));
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;
  const pageIndex = opts.pageIndex ?? 0;
  const page = await pdf.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: opts.scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2D canvas context');

  await page.render({ canvasContext: ctx, viewport }).promise;

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('canvas.toBlob returned null'));
    }, 'image/png');
  });

  return {
    blob,
    width: canvas.width,
    height: canvas.height,
    hash,
    pageCount: pdf.numPages,
  };
}

export async function rasterizeImage(
  source: File | Blob | ArrayBuffer,
  opts: { scale: number }
): Promise<RasterizeResult> {
  const buf =
    source instanceof ArrayBuffer ? source : await source.arrayBuffer();
  const hash = await sha256Hex(buf);
  const blob =
    source instanceof Blob ? source : new Blob([buf], { type: 'image/png' });
  const imageUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const next = new Image();
      next.onload = () => resolve(next);
      next.onerror = () => reject(new Error('Failed to load image'));
      next.src = imageUrl;
    });
    const width = Math.max(1, Math.round(image.naturalWidth * opts.scale));
    const height = Math.max(1, Math.round(image.naturalHeight * opts.scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D canvas context');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, width, height);
    const rasterBlob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error('canvas.toBlob returned null'));
      }, 'image/png');
    });
    return {
      blob: rasterBlob,
      width,
      height,
      hash,
      pageCount: 1,
    };
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export function detectSourceType(file: File | Blob): SourceType {
  const mime = file.type.toLowerCase();
  const name = 'name' in file && typeof file.name === 'string' ? file.name.toLowerCase() : '';
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (
    mime === 'image/png' ||
    mime === 'image/jpeg' ||
    mime === 'image/webp' ||
    name.endsWith('.png') ||
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    name.endsWith('.webp')
  ) {
    return 'image';
  }
  throw new Error('Unsupported file. Load a PDF, PNG, JPEG, WEBP, or .dnote.');
}

export async function rasterizeSource(
  source: File | Blob | ArrayBuffer,
  opts: { scale: number; pageIndex?: number; sourceType: SourceType }
): Promise<RasterizeResult> {
  if (opts.sourceType === 'pdf') {
    return rasterizePdf(source, { scale: opts.scale, pageIndex: opts.pageIndex });
  }
  return rasterizeImage(source, { scale: opts.scale });
}
