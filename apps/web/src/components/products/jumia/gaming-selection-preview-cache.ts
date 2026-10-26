import { jumiaPreviewCacheConstants, jumiaPreviewMessages } from './constants';
import { acquireGamingPreviewCreationLock } from './gaming-preview-creation-lock';
import { gamingSelectionPreviewErrors } from './gaming-selection-preview-errors';
import { gamingSelectionPreviewPersistence } from './gaming-selection-preview-persistence';

const uncertainCreations = new Set<string>();
const inFlightCreations = new Set<string>();

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (
      event.newValue === null &&
      event.key?.startsWith(jumiaPreviewCacheConstants.uncertainCreationPrefix)
    ) {
      uncertainCreations.delete(
        event.key.slice(
          jumiaPreviewCacheConstants.uncertainCreationPrefix.length
        )
      );
    }
  });
}

function uncertainCreationKey(merchantId: string) {
  return `${jumiaPreviewCacheConstants.uncertainCreationPrefix}${merchantId}`;
}

function subscribeToUncertainCreationClear(
  merchantId: string,
  onClear: () => void
) {
  if (typeof window === 'undefined') return () => undefined;
  const key = uncertainCreationKey(merchantId);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === key && event.newValue === null) {
      uncertainCreations.delete(merchantId);
      onClear();
    }
  };
  window.addEventListener('storage', handleStorage);
  return () => window.removeEventListener('storage', handleStorage);
}

function readCreationLease(merchantId: string) {
  try {
    const value = localStorage.getItem(uncertainCreationKey(merchantId));
    if (!value?.startsWith('in-flight:')) return null;
    const expiresAt = Number(value.slice('in-flight:'.length).split(':', 1)[0]);
    return Number.isFinite(expiresAt) ? expiresAt : null;
  } catch {
    return null;
  }
}

function hasActiveCreationLease(merchantId: string) {
  const expiresAt = readCreationLease(merchantId);
  return expiresAt !== null && expiresAt > Date.now();
}

function hasUncertainCreation(
  merchantId: string,
  reconcileExpiredLease = false
) {
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
      if (reconcileExpiredLease) markUncertainCreation(merchantId);
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
    // The active browser lock/lease protects the in-flight request until release.
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

async function beginCreation(
  merchantId: string,
  allowUncertainCreation = false,
  beforeLease?: () => Promise<boolean>
) {
  if (inFlightCreations.has(merchantId) || hasActiveCreationLease(merchantId))
    return null;
  const releaseCrossTabLock =
    await acquireGamingPreviewCreationLock(merchantId);
  if (!releaseCrossTabLock) return null;
  if (inFlightCreations.has(merchantId) || hasActiveCreationLease(merchantId)) {
    releaseCrossTabLock();
    return null;
  }
  if (!allowUncertainCreation && hasUncertainCreation(merchantId, true)) {
    releaseCrossTabLock();
    return null;
  }
  try {
    if (beforeLease && (await beforeLease())) {
      releaseCrossTabLock();
      return null;
    }
  } catch (cause) {
    releaseCrossTabLock();
    throw cause;
  }
  inFlightCreations.add(merchantId);
  const key = uncertainCreationKey(merchantId);
  const leaseToken = crypto.randomUUID();
  let lease = `in-flight:${Date.now() + jumiaPreviewCacheConstants.creationLeaseMs}:${leaseToken}`;
  const renewLease = () => {
    try {
      if (localStorage.getItem(key) !== lease) return;
      lease = `in-flight:${Date.now() + jumiaPreviewCacheConstants.creationLeaseMs}:${leaseToken}`;
      localStorage.setItem(key, lease);
    } catch {
      // The in-memory guard remains available for this browser session.
    }
  };
  try {
    localStorage.setItem(key, lease);
  } catch {
    inFlightCreations.delete(merchantId);
    releaseCrossTabLock();
    throw new Error(jumiaPreviewMessages.sharedStorageUnavailable);
  }
  const leaseRenewal = setInterval(
    renewLease,
    jumiaPreviewCacheConstants.creationLeaseRenewalMs
  );
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    clearInterval(leaseRenewal);
    inFlightCreations.delete(merchantId);
    try {
      if (localStorage.getItem(key) === lease) {
        if (uncertainCreations.has(merchantId)) {
          localStorage.setItem(key, 'pending');
        } else {
          localStorage.removeItem(key);
        }
      }
    } catch {
      // Leave the last persisted lease as a conservative recovery marker.
    } finally {
      releaseCrossTabLock();
    }
  };
}

async function loadKnownSuccessfulSelection(
  merchantId: string,
  load: (selectionId: string) => Promise<void>
) {
  if (inFlightCreations.has(merchantId)) return false;
  const releaseLock = await acquireGamingPreviewCreationLock(merchantId);
  if (!releaseLock) return false;
  try {
    if (inFlightCreations.has(merchantId)) return false;
    const entry =
      gamingSelectionPreviewPersistence.findKnownSuccessfulSelection(
        merchantId
      );
    if (!entry) return false;
    try {
      await load(entry.selection.selectionId);
      return true;
    } catch (cause) {
      if (!gamingSelectionPreviewErrors.isRejected(cause)) throw cause;
      gamingSelectionPreviewPersistence.clearKnownSuccessfulSelection(
        merchantId
      );
      gamingSelectionPreviewPersistence.removeIfMatches(
        entry.cacheKey,
        entry.selection.selectionId
      );
      return false;
    }
  } finally {
    releaseLock();
  }
}

async function loadFirstValid(
  merchantId: string,
  load: (selectionId: string) => Promise<void>
) {
  const releaseLock = await acquireGamingPreviewCreationLock(merchantId);
  if (!releaseLock) return false;
  try {
    return await gamingSelectionPreviewPersistence.loadFirstValid(
      merchantId,
      load
    );
  } finally {
    releaseLock();
  }
}

async function loadFirstValidForCategories(
  merchantId: string,
  categoryIds: string[],
  load: (selectionId: string) => Promise<void>
) {
  const releaseLock = await acquireGamingPreviewCreationLock(merchantId);
  if (!releaseLock) return false;
  try {
    return await gamingSelectionPreviewPersistence.loadFirstValidForCategories(
      merchantId,
      categoryIds,
      load
    );
  } finally {
    releaseLock();
  }
}

function hasCreationInFlight(merchantId: string) {
  if (inFlightCreations.has(merchantId)) return true;
  if (hasActiveCreationLease(merchantId)) return true;
  return false;
}

export const gamingSelectionPreviewCache = {
  ...gamingSelectionPreviewErrors,
  ...gamingSelectionPreviewPersistence,
  beginCreation,
  clearUncertainCreation,
  hasCreationInFlight,
  hasUncertainCreation,
  loadKnownSuccessfulSelection,
  loadFirstValid,
  loadFirstValidForCategories,
  markUncertainCreation,
  subscribeToUncertainCreationClear,
};
