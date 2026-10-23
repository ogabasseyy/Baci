import { jumiaPreviewCacheConstants } from './constants';
import { gamingSelectionPreviewErrors } from './gaming-selection-preview-errors';

type CachedSelection = { selectionId: string; expiresAt: string };
type CacheEntry = { cacheKey: string; selection: CachedSelection };

const memorySelections = new Map<string, CachedSelection>();
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function key(merchantId: string, categoryId: string) {
  return `${jumiaPreviewCacheConstants.cachePrefix}${merchantId}:${categoryId}`;
}

function read(cacheKey: string): CachedSelection | null {
  const memorySelection = memorySelections.get(cacheKey);
  let stored: string | null;
  try {
    stored = localStorage.getItem(cacheKey);
  } catch {
    return memorySelections.get(cacheKey) ?? null;
  }
  if (stored === null) return memorySelection ?? null;
  try {
    const value: unknown = JSON.parse(stored);
    if (
      gamingSelectionPreviewErrors.isRecord(value) &&
      typeof value.selectionId === 'string' &&
      UUID_PATTERN.test(value.selectionId) &&
      typeof value.expiresAt === 'string' &&
      Number.isFinite(Date.parse(value.expiresAt))
    ) {
      const persisted = {
        selectionId: value.selectionId,
        expiresAt: value.expiresAt,
      };
      if (
        memorySelection &&
        Date.parse(memorySelection.expiresAt) > Date.parse(persisted.expiresAt)
      ) {
        return memorySelection;
      }
      memorySelections.delete(cacheKey);
      return persisted;
    }
    try {
      localStorage.removeItem(cacheKey);
    } catch {
      // Keep a usable memory-only selection when storage cannot be cleaned.
    }
  } catch {
    try {
      localStorage.removeItem(cacheKey);
    } catch {
      // Keep a usable memory-only selection when storage cannot be cleaned.
    }
  }
  return memorySelection ?? null;
}

function findAll(merchantId: string): CacheEntry[] {
  const prefix = `${jumiaPreviewCacheConstants.cachePrefix}${merchantId}:`;
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
    const selection = read(cacheKey);
    if (selection) valid.push({ cacheKey, selection });
  }
  return valid.sort(
    (left, right) =>
      Date.parse(right.selection.expiresAt) -
      Date.parse(left.selection.expiresAt)
  );
}

async function loadFirstValid(
  merchantId: string,
  load: (selectionId: string) => Promise<void>
) {
  for (const entry of findAll(merchantId)) {
    try {
      await load(entry.selection.selectionId);
      return true;
    } catch (cause) {
      if (!gamingSelectionPreviewErrors.isRejected(cause)) throw cause;
      removeIfMatches(entry.cacheKey, entry.selection.selectionId);
    }
  }
  return false;
}

async function loadFirstValidForCategories(
  merchantId: string,
  categoryIds: string[],
  load: (selectionId: string) => Promise<void>
) {
  const categoryKeys = new Set(categoryIds.map((id) => key(merchantId, id)));
  for (const entry of findAll(merchantId)) {
    if (!categoryKeys.has(entry.cacheKey)) continue;
    try {
      await load(entry.selection.selectionId);
      return true;
    } catch (cause) {
      if (!gamingSelectionPreviewErrors.isRejected(cause)) throw cause;
      removeIfMatches(entry.cacheKey, entry.selection.selectionId);
    }
  }
  return false;
}

function find(merchantId: string): CacheEntry | null {
  return findAll(merchantId)[0] ?? null;
}

function remove(cacheKey: string) {
  memorySelections.delete(cacheKey);
  try {
    localStorage.removeItem(cacheKey);
  } catch {
    // The stale cache can be retried if storage is unavailable.
  }
}

function removeIfMatches(cacheKey: string, selectionId: string) {
  if (read(cacheKey)?.selectionId === selectionId) remove(cacheKey);
}

function write(cacheKey: string, selection: CachedSelection) {
  memorySelections.set(cacheKey, selection);
  try {
    localStorage.setItem(cacheKey, JSON.stringify(selection));
    memorySelections.delete(cacheKey);
    return true;
  } catch {
    // The current module keeps the usable selection for this browser session.
    return false;
  }
}

export const gamingSelectionPreviewPersistence = {
  find,
  key,
  loadFirstValid,
  loadFirstValidForCategories,
  read,
  remove,
  removeIfMatches,
  write,
};
