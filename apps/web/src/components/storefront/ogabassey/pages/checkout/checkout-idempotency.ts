export const CHECKOUT_IDEMPOTENCY_STORAGE_KEY =
  'storefront-checkout-idempotency';
export const CHECKOUT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

type StoredCheckoutIdempotency = {
  checkoutFingerprintHash: string;
  createdAt: number;
  key: string;
};

// Keys persist per fingerprint: several code-bearing checkouts can
// be in flight in one browser (different carts, merchants, tabs), and
// a single shared entry would let a later checkout overwrite an
// earlier attempt's recovery key — its retry would then mint a fresh
// key and lose the committed order. The stored value is a map from
// fingerprint hash to entry; the legacy single-entry shape still
// reads as a one-entry map.
type StoredCheckoutEntries = Record<
  string,
  { createdAt: number; key: string }
>;

function bufferToHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

async function hashCheckoutFingerprint(checkoutFingerprint: string) {
  try {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(checkoutFingerprint)
    );
    return bufferToHex(digest);
  } catch {
    return null;
  }
}

function isValidEntry(value: unknown): value is { createdAt: number; key: string } {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<{ createdAt: number; key: string }>;
  return (
    typeof entry.key === 'string' &&
    entry.key.trim().length > 0 &&
    typeof entry.createdAt === 'number'
  );
}

function readStoredEntries(): StoredCheckoutEntries {
  // An inaccessible store cannot establish whether a previous attempt exists.
  const raw = window.localStorage.getItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY);
  try {
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Partial<StoredCheckoutIdempotency> &
      Record<string, unknown>;
    const legacyHash = parsed.checkoutFingerprintHash;
    if (
      typeof legacyHash === 'string' &&
      legacyHash.trim().length > 0 &&
      isValidEntry(parsed)
    ) {
      // Legacy single-entry shape written before per-fingerprint keys.
      return {
        [legacyHash]: {
          createdAt: parsed.createdAt,
          key: parsed.key,
        },
      };
    }

    const entries: StoredCheckoutEntries = {};
    for (const [hash, value] of Object.entries(parsed)) {
      if (hash.trim().length > 0 && isValidEntry(value)) {
        entries[hash] = { createdAt: value.createdAt, key: value.key };
      }
    }
    return entries;
  } catch {
    return {};
  }
}

export async function getCheckoutIdempotencyKey(checkoutFingerprint: string) {
  if (checkoutFingerprint.trim().length === 0) {
    throw new Error(
      'Unable to preserve checkout recovery. Please reload and try again.'
    );
  }

  const checkoutFingerprintHash =
    await hashCheckoutFingerprint(checkoutFingerprint);
  if (!checkoutFingerprintHash) {
    throw new Error(
      'Unable to preserve checkout recovery. Please reload and try again.'
    );
  }

  let entries: StoredCheckoutEntries;
  try {
    entries = readStoredEntries();
  } catch {
    throw new Error(
      'Unable to read checkout recovery. Please enable browser storage and try again.'
    );
  }
  const now = Date.now();
  const existing = entries[checkoutFingerprintHash];
  if (existing && now - existing.createdAt <= CHECKOUT_IDEMPOTENCY_TTL_MS) {
    return existing.key;
  }

  const key = crypto.randomUUID();
  try {
    // Prune expired entries so abandoned attempts cannot grow the
    // stored map without bound; other live attempts keep their keys.
    const liveEntries: StoredCheckoutEntries = {};
    for (const [hash, entry] of Object.entries(entries)) {
      if (now - entry.createdAt <= CHECKOUT_IDEMPOTENCY_TTL_MS) {
        liveEntries[hash] = entry;
      }
    }
    liveEntries[checkoutFingerprintHash] = { createdAt: now, key };
    window.localStorage.setItem(
      CHECKOUT_IDEMPOTENCY_STORAGE_KEY,
      JSON.stringify(liveEntries)
    );
  } catch {
    throw new Error(
      'Unable to save checkout recovery. Please enable browser storage and try again.'
    );
  }

  return key;
}

export async function clearCheckoutIdempotencyKey(
  checkoutFingerprint?: string
) {
  try {
    if (checkoutFingerprint) {
      if (checkoutFingerprint.trim().length === 0) {
        return;
      }

      const checkoutFingerprintHash =
        await hashCheckoutFingerprint(checkoutFingerprint);
      if (!checkoutFingerprintHash) {
        return;
      }

      const entries = readStoredEntries();
      if (!(checkoutFingerprintHash in entries)) {
        return;
      }
      delete entries[checkoutFingerprintHash];
      if (Object.keys(entries).length === 0) {
        window.localStorage.removeItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY);
      } else {
        window.localStorage.setItem(
          CHECKOUT_IDEMPOTENCY_STORAGE_KEY,
          JSON.stringify(entries)
        );
      }
      return;
    }
    window.localStorage.removeItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY);
  } catch {
    // Storage access failed; there is nothing to clear.
  }
}
