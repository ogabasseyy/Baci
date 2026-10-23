type CachedSelection = { selectionId: string; expiresAt: string };

type CacheEntry = { cacheKey: string; selection: CachedSelection };
type PreviewRequestError = Error & { status: number };

const CACHE_PREFIX = 'jumia-gaming-preview:';
const UNCERTAIN_CREATION_PREFIX = 'jumia-gaming-preview-uncertain:';
const CREATION_LEASE_MS = 2 * 60 * 1000;
const CREATION_LEASE_RENEWAL_MS = 30 * 1000;
const memorySelections = new Map<string, CachedSelection>();
const uncertainCreations = new Set<string>();
const inFlightCreations = new Set<string>();
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (
      event.newValue !== null ||
      !event.key?.startsWith(UNCERTAIN_CREATION_PREFIX)
    )
      return;
    uncertainCreations.delete(
      event.key.slice(UNCERTAIN_CREATION_PREFIX.length)
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSelectionId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function createCacheKey(merchantId: string, categoryId: string) {
  return `${CACHE_PREFIX}${merchantId}:${categoryId}`;
}

function uncertainCreationKey(merchantId: string) {
  return `${UNCERTAIN_CREATION_PREFIX}${merchantId}`;
}

function readCreationLease(merchantId: string) {
  try {
    const value = localStorage.getItem(uncertainCreationKey(merchantId));
    if (!value?.startsWith('in-flight:')) return null;
    const expiresAt = Number(value.slice('in-flight:'.length));
    return Number.isFinite(expiresAt) ? expiresAt : null;
  } catch {
    return null;
  }
}

function hasActiveCreationLease(merchantId: string) {
  const expiresAt = readCreationLease(merchantId);
  return expiresAt !== null && expiresAt > Date.now();
}

function hasUncertainCreation(merchantId: string) {
  if (uncertainCreations.has(merchantId)) return true;
  try {
    const status = localStorage.getItem(uncertainCreationKey(merchantId));
    if (status === 'pending') {
      uncertainCreations.add(merchantId);
      return true;
    }
    if (
      status?.startsWith('in-flight:') &&
      !inFlightCreations.has(merchantId)
    ) {
      if (hasActiveCreationLease(merchantId)) return false;
      markUncertainCreation(merchantId);
      return true;
    }
    return false;
  } catch {
    return uncertainCreations.has(merchantId);
  }
}

function markUncertainCreation(merchantId: string) {
  uncertainCreations.add(merchantId);
  try {
    localStorage.setItem(uncertainCreationKey(merchantId), 'pending');
  } catch {
    // The in-memory safeguard remains available for this browser session.
  }
}

function clearUncertainCreation(merchantId: string) {
  uncertainCreations.delete(merchantId);
  try {
    localStorage.removeItem(uncertainCreationKey(merchantId));
  } catch {
    // The in-memory safeguard is cleared even when storage is unavailable.
  }
}

function beginCreation(merchantId: string) {
  if (inFlightCreations.has(merchantId) || hasActiveCreationLease(merchantId))
    return null;
  inFlightCreations.add(merchantId);
  let lease = `in-flight:${Date.now() + CREATION_LEASE_MS}`;
  const renewLease = () => {
    lease = `in-flight:${Date.now() + CREATION_LEASE_MS}`;
    try {
      localStorage.setItem(uncertainCreationKey(merchantId), lease);
    } catch {
      // The in-memory guard remains available for this browser session.
    }
  };
  try {
    localStorage.setItem(uncertainCreationKey(merchantId), lease);
  } catch {
    // Keep the in-flight guard in memory for this browser session.
  }
  const leaseRenewal = setInterval(renewLease, CREATION_LEASE_RENEWAL_MS);
  return () => {
    clearInterval(leaseRenewal);
    inFlightCreations.delete(merchantId);
    try {
      const key = uncertainCreationKey(merchantId);
      if (localStorage.getItem(key) === lease) {
        if (uncertainCreations.has(merchantId)) {
          localStorage.setItem(key, 'pending');
        } else {
          localStorage.removeItem(key);
        }
      }
    } catch {
      // The in-memory guard is released even when storage is unavailable.
    }
  };
}

function hasCreationInFlight(merchantId: string) {
  if (inFlightCreations.has(merchantId)) return true;
  if (hasActiveCreationLease(merchantId)) return true;
  try {
    if (
      localStorage
        .getItem(uncertainCreationKey(merchantId))
        ?.startsWith('in-flight:')
    ) {
      markUncertainCreation(merchantId);
    }
  } catch {
    // A storage-disabled in-flight request is represented in memory.
  }
  return false;
}

function readCachedSelection(cacheKey: string): CachedSelection | null {
  const memorySelection = memorySelections.get(cacheKey);
  if (memorySelection) return memorySelection;
  let stored: string | null;
  try {
    stored = localStorage.getItem(cacheKey);
  } catch {
    return memorySelections.get(cacheKey) ?? null;
  }
  if (stored === null) return memorySelections.get(cacheKey) ?? null;
  try {
    const value: unknown = JSON.parse(stored);
    if (
      isRecord(value) &&
      typeof value.selectionId === 'string' &&
      UUID_PATTERN.test(value.selectionId) &&
      typeof value.expiresAt === 'string' &&
      Number.isFinite(Date.parse(value.expiresAt))
    ) {
      return { selectionId: value.selectionId, expiresAt: value.expiresAt };
    }
    removeCachedSelection(cacheKey);
  } catch {
    removeCachedSelection(cacheKey);
  }
  return null;
}

function findCachedSelections(merchantId: string): CacheEntry[] {
  const prefix = `${CACHE_PREFIX}${merchantId}:`;
  const cacheKeys = [...memorySelections.keys()];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const cacheKey = localStorage.key(index);
      if (cacheKey) cacheKeys.push(cacheKey);
    }
  } catch {
    // In-memory entries remain available when browser storage is inaccessible.
  }
  const valid: CacheEntry[] = [];
  for (const cacheKey of new Set(cacheKeys)) {
    if (!cacheKey.startsWith(prefix)) continue;
    const selection = readCachedSelection(cacheKey);
    if (selection) valid.push({ cacheKey, selection });
  }
  return valid.sort(
    (left, right) =>
      Date.parse(right.selection.expiresAt) -
      Date.parse(left.selection.expiresAt)
  );
}

async function loadFirstValidCachedSelection(
  merchantId: string,
  load: (selectionId: string) => Promise<void>
) {
  for (const entry of findCachedSelections(merchantId)) {
    try {
      await load(entry.selection.selectionId);
      return true;
    } catch (cause) {
      if (!isRejectedCachedSelection(cause)) throw cause;
      removeCachedSelection(entry.cacheKey);
    }
  }
  return false;
}

async function loadFirstValidCachedSelectionForCategories(
  merchantId: string,
  categoryIds: string[],
  load: (selectionId: string) => Promise<void>
) {
  const categoryKeys = new Set(
    categoryIds.map((categoryId) => createCacheKey(merchantId, categoryId))
  );
  for (const entry of findCachedSelections(merchantId)) {
    if (!categoryKeys.has(entry.cacheKey)) continue;
    try {
      await load(entry.selection.selectionId);
      return true;
    } catch (cause) {
      if (!isRejectedCachedSelection(cause)) throw cause;
      removeCachedSelection(entry.cacheKey);
    }
  }
  return false;
}

function findCachedSelection(merchantId: string): CacheEntry | null {
  return findCachedSelections(merchantId)[0] ?? null;
}

function removeCachedSelection(cacheKey: string) {
  memorySelections.delete(cacheKey);
  try {
    localStorage.removeItem(cacheKey);
  } catch {
    // The stale cache can be retried if storage is unavailable.
  }
}

function writeCachedSelection(cacheKey: string, selection: CachedSelection) {
  memorySelections.set(cacheKey, selection);
  try {
    localStorage.setItem(cacheKey, JSON.stringify(selection));
    memorySelections.delete(cacheKey);
  } catch {
    // The current module keeps the usable selection for this browser session.
  }
}

function makePreviewRequestError(status: number, message: string) {
  return Object.assign(new Error(message), { status }) as PreviewRequestError;
}

function makeInvalidPageResponseError() {
  return makePreviewRequestError(
    422,
    'Unable to read the Gaming preview. Please create it again.'
  );
}

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

function isRejectedCachedSelection(cause: unknown) {
  return isRecord(cause) && (cause.status === 410 || cause.status === 422);
}

export const gamingSelectionPreviewCache = {
  clearUncertainCreation,
  beginCreation,
  find: findCachedSelection,
  hasUncertainCreation,
  hasCreationInFlight,
  key: createCacheKey,
  loadFirstValid: loadFirstValidCachedSelection,
  loadFirstValidForCategories: loadFirstValidCachedSelectionForCategories,
  markUncertainCreation,
  isRecord,
  isSelectionId,
  isRejected: isRejectedCachedSelection,
  errorMessage,
  makeInvalidPageResponseError,
  makeRequestError: makePreviewRequestError,
  read: readCachedSelection,
  remove: removeCachedSelection,
  write: writeCachedSelection,
};
