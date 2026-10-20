import { bumpCartSessionGeneration } from './shared-cart-storage';

const LOCK_NAME = 'baci-cart-cookie-authority';
const EPOCH_KEY = 'baci-cart-authority-epoch';
let listening = false;
let activeWrites = 0;
let lastInvalidatedEpoch: string | null | undefined | symbol =
  Symbol('initial');
function invalidateEpoch(value: string | null | undefined) {
  if (lastInvalidatedEpoch === value) return;
  lastInvalidatedEpoch = value;
  bumpCartSessionGeneration();
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
function epoch(): string | null {
  if (typeof window === 'undefined') return null;
  if (!listening) {
    window.addEventListener('storage', (event) => {
      if (event.key === EPOCH_KEY) invalidateEpoch(event.newValue);
    });
    listening = true;
  }
  return window.localStorage.getItem(EPOCH_KEY);
}

export function getCartCookieEpoch(): string | null | undefined {
  try {
    return epoch();
  } catch {
    return undefined;
  }
}
/** Fence old UI intents even before a delayed cross-tab storage event arrives. */
export function isCartCookieEpochCurrent(
  expected: string | null | undefined
): boolean {
  const current = getCartCookieEpoch();
  if (current !== undefined && expected !== undefined && current === expected)
    return true;
  invalidateEpoch(current);
  return false;
}

/** Shared locks cover the entire request, including headers/cookie delivery. */
export function withCartCookieWrite<T>(
  fallback: T,
  signal: AbortSignal,
  operation: () => Promise<T>
): Promise<T> {
  const manager = lockManager();
  if (!manager) return operation();
  const startedEpoch = epoch();
  return manager.request(LOCK_NAME, { mode: 'shared', signal }, () => {
    // A request queued before retirement must not mint authority afterward.
    if (signal.aborted || epoch() !== startedEpoch) return fallback;
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
  guard?: { expectedEpoch: string | null | undefined }
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
        const currentEpoch = epoch();
        if (
          guard &&
          (guard.expectedEpoch === undefined ||
            currentEpoch !== guard.expectedEpoch)
        )
          throw new Error('Cart authority changed while waiting');
        window.localStorage.setItem(EPOCH_KEY, crypto.randomUUID());
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
