/** Cross-tab notices never contain account identifiers or order details. */
const STORAGE_KEY = 'baci:customer-identity-changed';
const CHANNEL_NAME = 'baci-customer-identity';
const source =
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
let sequence = 0;

interface IdentityNotice {
  type: 'invalidate';
  source: string;
  merchantSlug: string | null;
  sequence: number;
}

function isNotice(value: unknown): value is IdentityNotice {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === 'invalidate' &&
    typeof candidate.source === 'string' &&
    (candidate.merchantSlug === null ||
      typeof candidate.merchantSlug === 'string') &&
    typeof candidate.sequence === 'number'
  );
}

/** Publish an invalidation after a local identity publication. */
export function broadcastCustomerIdentityInvalidation(
  merchantSlug: string | null
): void {
  if (typeof window === 'undefined') return;
  const notice: IdentityNotice = {
    type: 'invalidate',
    source,
    merchantSlug,
    sequence: ++sequence,
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notice));
  } catch {
    /* Channel may still work. */
  }
  try {
    if (typeof window.BroadcastChannel === 'function') {
      const channel = new window.BroadcastChannel(CHANNEL_NAME);
      channel.postMessage(notice);
      channel.close();
    }
  } catch {
    /* Storage and focus invalidation remain available. */
  }
}

/** Subscribe to other tabs and fail closed when neither cross-tab transport works. */
export function subscribeCustomerIdentityInvalidation(listener: () => void) {
  if (typeof window === 'undefined')
    return { available: false, unsubscribe: () => undefined };
  const receive = (value: unknown) => {
    if (isNotice(value) && value.source !== source) listener();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      receive(JSON.parse(event.newValue));
    } catch {
      /* Ignore malformed notices. */
    }
  };
  let storageAvailable = false;
  try {
    const probe = `${STORAGE_KEY}:probe:${source}`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    storageAvailable = true;
    window.addEventListener('storage', onStorage);
  } catch {
    /* BroadcastChannel may still work. */
  }
  let channel: BroadcastChannel | undefined;
  try {
    if (typeof window.BroadcastChannel === 'function') {
      channel = new window.BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event) => receive(event.data);
    }
  } catch {
    /* The storage listener may still work. */
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') listener();
  };
  window.addEventListener('focus', listener);
  document.addEventListener('visibilitychange', onVisible);
  return {
    available: storageAvailable || !!channel,
    unsubscribe: () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', listener);
      document.removeEventListener('visibilitychange', onVisible);
      channel?.close();
    },
  };
}
