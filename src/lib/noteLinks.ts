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
  return value
    .replace(/https?:\/\/[^\s<>()"']+/gi, '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function composeNoteContent(body: string, urls: string[]): string {
  const trimmedBody = body.trim();
  if (trimmedBody && urls.length > 0) {
    return `${trimmedBody}\n\n${urls.join('\n')}`;
  }
  if (trimmedBody) return trimmedBody;
  return urls.join('\n');
}

export function splitNoteContent(value: string) {
  return {
    body: stripUrlsFromContent(value),
    urls: extractUrls(value),
  };
}
