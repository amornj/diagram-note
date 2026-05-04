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
