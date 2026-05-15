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
  // When URLs are present, the trailing whitespace was the `\n\n` separator
  // that composeNoteContent inserted — strip it so split→compose round-trips
  // cleanly and the editor doesn't accumulate phantom newlines on each keystroke.
  return hasUrls ? stripped.replace(/\s+$/, '') : stripped;
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
