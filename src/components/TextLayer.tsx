import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import OpenSeadragon from 'openseadragon';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

interface Props {
  pdfBlob: Blob;
  pageIndex: number;
  viewer: OpenSeadragon.Viewer;
}

export default function TextLayer({ pdfBlob, pageIndex, viewer }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // State (not ref) so the transform effect re-runs when PDF finishes loading.
  const [pageSize, setPageSize] = useState({ w: 0, h: 0 });

  // Load PDF and render the PDF.js text layer into the container.
  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = '';
    setPageSize({ w: 0, h: 0 });

    (async () => {
      const buf = await pdfBlob.arrayBuffer();
      if (cancelled) return;
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
      if (cancelled) { pdf.destroy(); return; }

      const page = await pdf.getPage(pageIndex + 1);
      if (cancelled) { pdf.destroy(); return; }

      const viewport = page.getViewport({ scale: 1 });
      container.style.width = `${viewport.width}px`;
      container.style.height = `${viewport.height}px`;

      const textLayer = new pdfjsLib.TextLayer({
        textContentSource: page.streamTextContent(),
        container,
        viewport,
      });

      await textLayer.render();
      pdf.destroy();

      if (cancelled) {
        container.innerHTML = '';
      } else {
        // Setting state here causes the transform effect to re-run with correct w.
        setPageSize({ w: viewport.width, h: viewport.height });
      }
    })();

    return () => {
      cancelled = true;
      if (container) container.innerHTML = '';
    };
  }, [pdfBlob, pageIndex]);

  // Keep the text layer div positioned and scaled to match the OSD viewport.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !pageSize.w) return;

    const update = () => {
      const tl = viewer.viewport.pixelFromPoint(new OpenSeadragon.Point(0, 0), true);
      const tr = viewer.viewport.pixelFromPoint(new OpenSeadragon.Point(1, 0), true);
      const cssScale = (tr.x - tl.x) / pageSize.w;
      container.style.transform = `translate(${tl.x}px, ${tl.y}px) scale(${cssScale})`;
    };

    update();
    viewer.addHandler('viewport-change', update);
    viewer.addHandler('animation', update);

    return () => {
      viewer.removeHandler('viewport-change', update);
      viewer.removeHandler('animation', update);
    };
  }, [viewer, pageSize]);

  return (
    <div
      ref={containerRef}
      className="pdf-text-layer absolute top-0 left-0 pointer-events-auto"
      style={{ transformOrigin: '0 0', zIndex: 25, cursor: 'text' }}
    />
  );
}
