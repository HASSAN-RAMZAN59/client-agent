/**
 * Safely extracts the base domain (hostname) from a URL string.
 */
export function extractDomain(rawUrl: string): string | null {
  if (!rawUrl) return null;

  try {
    const withProtocol = rawUrl.startsWith('http://') || rawUrl.startsWith('https://')
      ? rawUrl
      : `https://${rawUrl}`;
    const parsed = new URL(withProtocol);
    return parsed.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return rawUrl.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
  }
}
