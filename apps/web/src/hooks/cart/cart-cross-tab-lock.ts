import { bumpCartSessionGeneration } from './shared-cart-storage';

const LOCK_NAME = 'baci-cart-cookie-authority';
const EPOCH_KEY = 'baci-cart-authority-epoch';
let listening = false;
let activeWrites = 0;
const lastInvalidatedEpochs = new Map<string, string | null | undefined>();
const epochKey = (slug?: string | null) =>
  slug ? `${EPOCH_KEY}:${slug}` : EPOCH_KEY;
function invalidateEpoch(
  value: string | null | undefined,
  slug?: string | null
) {
  const key = epochKey(slug);
  if (
    lastInvalidatedEpochs.has(key) &&
    lastInvalidatedEpochs.get(key) === value
  )
    return;
  lastInvalidatedEpochs.set(key, value);
  bumpCartSessionGeneration(slug ? { merchantSlug: slug } : undefined);
}
export const hasActiveCartCookieWrite = () => activeWrites > 0;

function lockManager(): LockManager | undefined {
  if (typeof navigator !== 'undefined' && navigator.locks)
    return navigator.locks;
  // Production shared-cart cookies require HTTPS. Never silently fall back
  // to a realm-local fence in a secure browser that cannot coordinate tabs.
  if (typeof window !== 'undefined' && window.isSecureContext)
    throw new Error('Cross-tab cart coordination is unavailable');
  return undefined;
}
function epoch(slug?: string | null): string | null {
  if (typeof window === 'undefined') return null;
  if (!listening) {
    window.addEventListener('storage', (event) => {
      if (event.key === EPOCH_KEY || event.key === null)
        invalidateEpoch(event.newValue);
      else if (
        event.key?.startsWith(`${EPOCH_KEY}:`) &&
        !event.key.endsWith(':writable')
      )
        invalidateEpoch(event.newValue, event.key.slice(EPOCH_KEY.length + 1));
    });
    listening = true;
  }
  return window.localStorage.getItem(epochKey(slug));
}

export function getCartCookieEpoch(
  slug?: string | null
): string | null | undefined {
  try {
    return epoch(slug);
  } catch {
    return undefined;
  }
}
/** Fence old UI intents even before a delayed cross-tab storage event arrives. */
export function isCartCookieEpochCurrent(
  expected: string | null | undefined,
  slug?: string | null
): boolean {
  const current = getCartCookieEpoch(slug);
  if (current !== undefined && expected !== undefined && current === expected)
    return true;
  invalidateEpoch(current, slug);
  return false;
}

/** Serialize cookie writers through response headers and cookie delivery. */
export function withCartCookieWrite<T>(
  fallback: T,
  signal: AbortSignal,
  operation: () => Promise<T>,
  slug?: string | null
): Promise<T> {
  const manager = lockManager();
  if (!manager) return operation();
  const startedEpoch = epoch(slug);
  return manager.request(LOCK_NAME, { mode: 'exclusive', signal }, () => {
    // A request queued before retirement must not mint authority afterward.
    if (signal.aborted || epoch(slug) !== startedEpoch) return fallback;
    // Every realm must prove coordination storage is writable before sending.
    // A read-only tab must not reuse the old epoch after failed retirement.
    window.localStorage.setItem(`${epochKey(slug)}:writable`, '1');
    activeWrites += 1;
    let cancel!: () => void;
    const aborted = new Promise<T>((resolve) => {
      cancel = () => resolve(fallback);
      signal.addEventListener('abort', cancel, { once: true });
    });
    return Promise.race([Promise.resolve().then(operation), aborted]).finally(
      () => {
        activeWrites -= 1;
        signal.removeEventListener('abort', cancel);
      }
    );
  });
}

/** Hold an origin-wide exclusive lock until the caller finishes revocation. */
export function beginCartCookieRetirement(
  timeoutMs: number,
  guard?: { expectedEpoch: string | null | undefined },
  slug?: string | null
): {
  drained: Promise<void>;
  release(): void;
} {
  let manager: LockManager | undefined;
  try {
    manager = lockManager();
  } catch (error) {
    return {
      drained: Promise.reject(error),
      release() {
        /* No lock was acquired. */
      },
    };
  }
  if (!manager)
    return {
      drained: Promise.resolve(),
      release() {
        /* No lock was acquired. */
      },
    };
  const controller = new AbortController();
  let acquired = false;
  let unlock!: () => void;
  const held = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  let ready!: () => void;
  let fail!: (error: unknown) => void;
  const drained = new Promise<void>((resolve, reject) => {
    ready = resolve;
    fail = reject;
  });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  void manager
    .request(
      LOCK_NAME,
      { mode: 'exclusive', signal: controller.signal },
      async () => {
        acquired = true;
        clearTimeout(timer);
        // Storage errors fail closed before revocation starts. This also fences
        // queued work in other tabs, even if a storage event is delivered late.
        const currentEpoch = epoch(slug);
        if (
          guard &&
          (guard.expectedEpoch === undefined ||
            currentEpoch !== guard.expectedEpoch)
        )
          throw new Error('Cart authority changed while waiting');
        window.localStorage.setItem(epochKey(slug), crypto.randomUUID());
        ready();
        await held;
      }
    )
    .catch(fail)
    .finally(() => clearTimeout(timer));
  return {
    drained,
    release() {
      clearTimeout(timer);
      if (!acquired) controller.abort();
      unlock();
    },
  };
}
