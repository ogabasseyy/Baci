type CachedSelection = { selectionId: string; expiresAt: string };

type CacheEntry = { cacheKey: string; selection: CachedSelection };
type PreviewRequestError = Error & { status: number };

const CACHE_PREFIX = 'jumia-gaming-preview:';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readCachedSelection(cacheKey: string): CachedSelection | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(cacheKey) ?? 'null');
    if (
      isRecord(value) &&
      typeof value.selectionId === 'string' &&
      UUID_PATTERN.test(value.selectionId) &&
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

function findCachedSelection(merchantId: string): CacheEntry | null {
  try {
    const prefix = `${CACHE_PREFIX}${merchantId}:`;
    const cacheKeys = Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.key(index)
    );
    let newest: CacheEntry | null = null;
    for (const cacheKey of cacheKeys) {
      if (!cacheKey?.startsWith(prefix)) continue;
      const selection = readCachedSelection(cacheKey);
      if (
        selection &&
        (!newest ||
          Date.parse(selection.expiresAt) >
            Date.parse(newest.selection.expiresAt))
      ) {
        newest = { cacheKey, selection };
      }
    }
    return newest;
  } catch {
    // Preview creation still works without local storage.
  }
  return null;
}

function removeCachedSelection(cacheKey: string) {
  try {
    localStorage.removeItem(cacheKey);
  } catch {
    // The stale cache can be retried if storage is unavailable.
  }
}

function makePreviewRequestError(status: number, message: string) {
  return Object.assign(new Error(message), { status }) as PreviewRequestError;
}

function isRejectedCachedSelection(cause: unknown) {
  return (
    isRecord(cause) &&
    (cause.status === 404 || cause.status === 410 || cause.status === 422)
  );
}

export const gamingSelectionPreviewCache = {
  find: findCachedSelection,
  isRecord,
  isRejected: isRejectedCachedSelection,
  makeRequestError: makePreviewRequestError,
  read: readCachedSelection,
  remove: removeCachedSelection,
};
