export type CachedSelection = { selectionId: string; expiresAt: string };

type CacheEntry = { cacheKey: string; selection: CachedSelection };
type PreviewRequestError = Error & { status: number };

const CACHE_PREFIX = 'jumia-gaming-preview:';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function readCachedSelection(cacheKey: string): CachedSelection | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(cacheKey) ?? 'null');
    if (
      isRecord(value) &&
      typeof value.selectionId === 'string' &&
      typeof value.expiresAt === 'string' &&
      Date.parse(value.expiresAt) > Date.now()
    ) {
      return { selectionId: value.selectionId, expiresAt: value.expiresAt };
    }
    localStorage.removeItem(cacheKey);
  } catch {
    // Ignore unavailable storage or malformed cached values.
    removeCachedSelection(cacheKey);
  }
  return null;
}

export function findCachedSelection(merchantId: string): CacheEntry | null {
  try {
    const prefix = `${CACHE_PREFIX}${merchantId}:`;
    for (let index = 0; index < localStorage.length; index += 1) {
      const cacheKey = localStorage.key(index);
      if (!cacheKey?.startsWith(prefix)) continue;
      const selection = readCachedSelection(cacheKey);
      if (selection) return { cacheKey, selection };
    }
  } catch {
    // Preview creation still works without local storage.
  }
  return null;
}

export function removeCachedSelection(cacheKey: string) {
  try {
    localStorage.removeItem(cacheKey);
  } catch {
    // The stale cache can be retried if storage is unavailable.
  }
}

export function makePreviewRequestError(status: number, message: string) {
  return Object.assign(new Error(message), { status }) as PreviewRequestError;
}

export function isRejectedCachedSelection(cause: unknown) {
  return isRecord(cause) && (cause.status === 404 || cause.status === 410);
}
