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

function perFingerprintStorageKey(hash: string) {
  return `${CHECKOUT_IDEMPOTENCY_STORAGE_KEY}:${hash}`;
}

function readPerFingerprint(hash: string) {
  const raw = window.localStorage.getItem(perFingerprintStorageKey(hash));
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValidEntry(parsed) &&
      Number.isFinite(parsed.createdAt) &&
      parsed.createdAt > 0
      ? { createdAt: parsed.createdAt, key: parsed.key }
      : null;
  } catch {
    return null;
  }
}

function writePerFingerprint(
  hash: string,
  entry: { createdAt: number; key: string }
) {
  window.localStorage.setItem(
    perFingerprintStorageKey(hash),
    JSON.stringify(entry)
  );
}

function removeLegacyEntry(hash: string, entries: StoredCheckoutEntries) {
  delete entries[hash];
  if (Object.keys(entries).length === 0) {
    window.localStorage.removeItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY);
  } else {
    window.localStorage.setItem(
      CHECKOUT_IDEMPOTENCY_STORAGE_KEY,
      JSON.stringify(entries)
    );
  }
}

function pruneExpiredPerFingerprint(now: number) {
  const prefix = `${CHECKOUT_IDEMPOTENCY_STORAGE_KEY}:`;
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const storageKey = window.localStorage.key(i);
    if (storageKey?.startsWith(prefix)) {
      keys.push(storageKey);
    }
  }
  for (const storageKey of keys) {
    const entry = readPerFingerprint(storageKey.slice(prefix.length));
    if (!entry || now - entry.createdAt > CHECKOUT_IDEMPOTENCY_TTL_MS) {
      window.localStorage.removeItem(storageKey);
    }
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

  const now = Date.now();
  let entries: StoredCheckoutEntries;
  let perFingerprint: { createdAt: number; key: string } | null;
  try {
    perFingerprint = readPerFingerprint(checkoutFingerprintHash);
    entries = readStoredEntries();
  } catch {
    throw new Error(
      'Unable to read checkout recovery. Please enable browser storage and try again.'
    );
  }
  // Each fingerprint owns an independent storage slot, so concurrent
  // tabs beginning different checkouts never rewrite one shared map:
  // a read-modify-write of a shared value could clobber the other
  // tab's just-saved recovery key.
  if (
    perFingerprint &&
    now - perFingerprint.createdAt <= CHECKOUT_IDEMPOTENCY_TTL_MS
  ) {
    return perFingerprint.key;
  }
  const legacy = entries[checkoutFingerprintHash];
  if (legacy && now - legacy.createdAt <= CHECKOUT_IDEMPOTENCY_TTL_MS) {
    // Migrate the legacy shared-map entry into its own slot.
    try {
      writePerFingerprint(checkoutFingerprintHash, legacy);
      removeLegacyEntry(checkoutFingerprintHash, entries);
    } catch {
      // Migration is best-effort; the legacy entry still resolves.
    }
    return legacy.key;
  }

  const key = crypto.randomUUID();
  try {
    pruneExpiredPerFingerprint(now);
    window.localStorage.setItem(
      perFingerprintStorageKey(checkoutFingerprintHash),
      JSON.stringify({ createdAt: now, key })
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

      window.localStorage.removeItem(
        perFingerprintStorageKey(checkoutFingerprintHash)
      );
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
    const prefix = `${CHECKOUT_IDEMPOTENCY_STORAGE_KEY}:`;
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const storageKey = window.localStorage.key(i);
      if (storageKey?.startsWith(prefix)) {
        keys.push(storageKey);
      }
    }
    for (const storageKey of keys) {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    // Storage access failed; there is nothing to clear.
  }
}
