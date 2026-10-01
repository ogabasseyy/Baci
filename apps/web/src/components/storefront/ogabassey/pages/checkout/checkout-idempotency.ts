export const CHECKOUT_IDEMPOTENCY_STORAGE_KEY =
  'storefront-checkout-idempotency';
export const CHECKOUT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

type StoredCheckoutIdempotency = {
  checkoutFingerprintHash: string;
  createdAt: number;
  key: string;
};

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

function readStoredKey(): StoredCheckoutIdempotency | null {
  // An inaccessible store cannot establish whether a previous attempt exists.
  const raw = window.localStorage.getItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY);
  try {
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<StoredCheckoutIdempotency>;
    if (
      typeof parsed.checkoutFingerprintHash !== 'string' ||
      parsed.checkoutFingerprintHash.trim().length === 0 ||
      typeof parsed.key !== 'string' ||
      parsed.key.trim().length === 0 ||
      typeof parsed.createdAt !== 'number'
    ) {
      return null;
    }

    return {
      checkoutFingerprintHash: parsed.checkoutFingerprintHash,
      createdAt: parsed.createdAt,
      key: parsed.key,
    };
  } catch {
    return null;
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

  let stored: StoredCheckoutIdempotency | null;
  try {
    stored = readStoredKey();
  } catch {
    throw new Error(
      'Unable to read checkout recovery. Please enable browser storage and try again.'
    );
  }
  const now = Date.now();
  if (
    stored?.checkoutFingerprintHash === checkoutFingerprintHash &&
    now - stored.createdAt <= CHECKOUT_IDEMPOTENCY_TTL_MS
  ) {
    return stored.key;
  }

  const key = crypto.randomUUID();
  try {
    window.localStorage.setItem(
      CHECKOUT_IDEMPOTENCY_STORAGE_KEY,
      JSON.stringify({ checkoutFingerprintHash, createdAt: now, key })
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

      const stored = readStoredKey();
      if (stored?.checkoutFingerprintHash !== checkoutFingerprintHash) {
        return;
      }
    }
    window.localStorage.removeItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY);
  } catch {
    // Storage access failed; there is nothing to clear.
  }
}
