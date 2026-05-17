export function normalizeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function extractUrls(value: string): string[] {
  const matches = value.match(/https?:\/\/[^\s<>()"']+/gi) ?? [];
  const urls = matches
    .map((match) => normalizeUrl(match))
    .filter((url): url is string => url !== null);
  return Array.from(new Set(urls));
}

export function stripUrlsFromContent(value: string): string {
  const hasUrls = /https?:\/\/[^\s<>()"']+/i.test(value);
  const stripped = value
    .replace(/https?:\/\/[^\s<>()"']+/gi, '')
    .replace(/\r\n/g, '\n');
  // When URLs are present, strip the trailing newlines from the `\n\n` separator
  // that composeNoteContent inserted — but keep trailing spaces so typing a
  // space at end of body isn't eaten on every round-trip.
  return hasUrls ? stripped.replace(/\n+$/, '') : stripped;
}

export function composeNoteContent(body: string, urls: string[]): string {
  const normalizedBody = body.replace(/\r\n/g, '\n');
  const hasBody = normalizedBody.trim().length > 0;
  if (hasBody && urls.length > 0) {
    return `${normalizedBody}\n\n${urls.join('\n')}`;
  }
  if (hasBody) return normalizedBody;
  return urls.join('\n');
}

export function splitNoteContent(value: string) {
  return {
    body: stripUrlsFromContent(value),
    urls: extractUrls(value),
  };
}

/**
 * Process raw editor text: replace inline URLs with `[N]` markers, renumber
 * existing markers in left-to-right order, and drop URLs whose marker was
 * deleted. Legacy URLs that lacked any marker in the prior body are kept and
 * appended at the end so opening an old note doesn't lose its links.
 */
export function processEditorBody(
  rawBody: string,
  existingBody: string,
  existingUrls: string[],
): { body: string; urls: string[] } {
  type Token =
    | { kind: 'marker'; start: number; end: number; num: number }
    | { kind: 'url'; start: number; end: number; url: string };

  const tokens: Token[] = [];
  for (const m of rawBody.matchAll(/\[(\d+)\]/g)) {
    tokens.push({
      kind: 'marker',
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      num: parseInt(m[1], 10),
    });
  }
  for (const m of rawBody.matchAll(/https?:\/\/[^\s<>()"']+/gi)) {
    tokens.push({
      kind: 'url',
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      url: m[0],
    });
  }
  tokens.sort((a, b) => a.start - b.start);

  const newUrls: string[] = [];
  const refOf = (url: string): number => {
    const i = newUrls.indexOf(url);
    if (i !== -1) return i + 1;
    newUrls.push(url);
    return newUrls.length;
  };

  let newBody = '';
  let pos = 0;
  for (const tok of tokens) {
    newBody += rawBody.slice(pos, tok.start);
    if (tok.kind === 'marker') {
      const url = existingUrls[tok.num - 1];
      if (url) {
        newBody += `[${refOf(url)}]`;
      } else {
        newBody += rawBody.slice(tok.start, tok.end);
      }
    } else {
      const normalized = normalizeUrl(tok.url);
      if (normalized) {
        newBody += `[${refOf(normalized)}]`;
      } else {
        newBody += rawBody.slice(tok.start, tok.end);
      }
    }
    pos = tok.end;
  }
  newBody += rawBody.slice(pos);

  const prevMarkers = new Set<number>();
  for (const m of existingBody.matchAll(/\[(\d+)\]/g)) {
    prevMarkers.add(parseInt(m[1], 10));
  }
  for (let i = 0; i < existingUrls.length; i++) {
    const url = existingUrls[i];
    if (newUrls.includes(url)) continue;
    if (prevMarkers.has(i + 1)) continue;
    const num = refOf(url);
    const sep = newBody.length === 0 || /\s$/.test(newBody) ? '' : ' ';
    newBody += `${sep}[${num}]`;
  }

  return { body: newBody, urls: newUrls };
}

/** Ensure every URL has an inline `[N]` marker in the body. */
export function ensureMarkers(body: string, urls: string[]): string {
  if (urls.length === 0) return body;
  const present = new Set<number>();
  for (const m of body.matchAll(/\[(\d+)\]/g)) {
    present.add(parseInt(m[1], 10));
  }
  let out = body;
  for (let i = 0; i < urls.length; i++) {
    if (present.has(i + 1)) continue;
    const sep = out.length === 0 || /\s$/.test(out) ? '' : ' ';
    out += `${sep}[${i + 1}]`;
  }
  return out;
}

export function openUrlsInTabs(urls: string[]) {
  if (urls.length === 0) return;
  if (urls.length === 1) {
    window.open(urls[0], '_blank', 'noopener,noreferrer');
    return;
  }
  const escapedLinks = urls
    .map(
      (url, index) =>
        `<li style="margin:0 0 12px"><a href="${url.replace(/"/g, '&quot;')}" target="_blank" rel="noreferrer noopener" style="color:#0369a1;text-decoration:none;word-break:break-all">Link ${index + 1}</a></li>`
    )
    .join('');
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Note Links</title>
  </head>
  <body style="margin:0;font-family:system-ui,-apple-system,sans-serif;background:#fff8eb;color:#7c2d12">
    <div style="max-width:720px;margin:0 auto;padding:24px">
      <h1 style="margin:0 0 16px;font-size:20px">Note Links</h1>
      <p style="margin:0 0 20px;font-size:14px">Open any link below.</p>
      <ol style="padding-left:20px;margin:0">${escapedLinks}</ol>
    </div>
  </body>
</html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const blobUrl = URL.createObjectURL(blob);
  const opened = window.open(blobUrl, '_blank', 'noopener,noreferrer');
  if (!opened) {
    URL.revokeObjectURL(blobUrl);
    return;
  }
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}
