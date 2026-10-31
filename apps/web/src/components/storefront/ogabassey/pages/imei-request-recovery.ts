const PREFIX = 'baci:imei-attempt:v1:';

async function storageKeyFor(identity: readonly string[]) {
  const bytes = new TextEncoder().encode(JSON.stringify(identity));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return PREFIX + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function acquireImeiRecoveryKey(identity: readonly string[], createKey: () => string) {
  const storageKey = await storageKeyFor(identity);
  if (!navigator.locks) throw new Error('Safe recovery is unavailable');
  return navigator.locks.request(storageKey, () => {
    const existing = localStorage.getItem(storageKey);
    if (existing) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)) throw new Error('Invalid stored recovery key');
      return { storageKey, idempotencyKey: existing };
    }
    const idempotencyKey = createKey();
    localStorage.setItem(storageKey, idempotencyKey);
    return { storageKey, idempotencyKey };
  });
}

export async function clearImeiRecoveryKey(storageKey: string, idempotencyKey: string) {
  if (!/^baci:imei-attempt:v1:[0-9a-f]{64}$/.test(storageKey) || !navigator.locks) throw new Error('Invalid recovery key');
  await navigator.locks.request(storageKey, () => {
    if (localStorage.getItem(storageKey) === idempotencyKey) localStorage.removeItem(storageKey);
  });
}
