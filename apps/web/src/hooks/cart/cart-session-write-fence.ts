import {
  beginCartCookieRetirement,
  getCartCookieEpoch,
  isCartCookieEpochCurrent,
  withCartCookieWrite,
} from './cart-cross-tab-lock';
import {
  CART_REQUEST_TIMEOUT_MS,
  withCartRequestDeadline,
} from './cart-request-deadline';
import { bumpCartSessionGeneration } from './shared-cart-storage';

/** Drain authority-creating requests before retiring the cookie they can install. */
const flights = new Map<Promise<unknown>, string>();
const retirements = new Map<string, number>();
const acquiredRetirements = new Map<string, number>();
export function isCartSessionRetirementReady(slug?: string | null): boolean {
  return acquiredRetirements.has(slug ?? '');
}
const overlaps = (a: string, b: string) => !a || !b || a === b;

export function isCartSessionRetiring(slug?: string | null): boolean {
  return [...retirements.keys()].some((key) => overlaps(key, slug ?? ''));
}

export function runCartSessionWrite<T>(
  slug: string | null | undefined,
  blocked: T,
  operation: () => Promise<T>
): Promise<T> {
  if (isCartSessionRetiring(slug)) return Promise.resolve(blocked);
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const pending = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  }).finally(() => flights.delete(pending));
  flights.set(pending, slug ?? '');
  try {
    resolve(operation());
  } catch (error) {
    reject(error);
  }
  return pending;
}

export function beginCartSessionRetirement(
  slug: string,
  guard?: { expectedEpoch: string | null | undefined }
) {
  retirements.set(slug, (retirements.get(slug) ?? 0) + 1);
  let crossTab: ReturnType<typeof beginCartCookieRetirement> | undefined;
  let ownsAcquiredRetirement = false;
  const drained = Promise.allSettled(
    [...flights]
      .filter(([, key]) => overlaps(key, slug))
      .map(([pending]) => pending)
  ).then(async () => {
    if (released) return;
    crossTab = beginCartCookieRetirement(CART_REQUEST_TIMEOUT_MS, guard, slug);
    await crossTab.drained;
    if (!released) {
      acquiredRetirements.set(slug, (acquiredRetirements.get(slug) ?? 0) + 1);
      ownsAcquiredRetirement = true;
    }
  });
  let released = false;
  return {
    drained,
    release() {
      if (released) return;
      released = true;
      crossTab?.release();
      if (ownsAcquiredRetirement) {
        const acquired = (acquiredRetirements.get(slug) ?? 0) - 1;
        if (acquired > 0) acquiredRetirements.set(slug, acquired);
        else acquiredRetirements.delete(slug);
      }
      const count = (retirements.get(slug) ?? 1) - 1;
      if (count) retirements.set(slug, count);
      else retirements.delete(slug);
    },
  };
}

/** Serialize an explicit cart selection after writes that can overwrite its cookie. */
export function runCartSessionTransition<T>(
  slug: string | null | undefined,
  blocked: T,
  operation: () => Promise<T>,
  outcome?: {
    isSuccessful(result: T): boolean;
    operationId?: string;
    canRetry?(result: T): boolean;
    signal?: AbortSignal;
  }
): Promise<T> {
  if (isCartSessionRetiring(slug) || outcome?.signal?.aborted)
    return Promise.resolve(blocked);
  const startedEpoch = getCartCookieEpoch(slug);
  const retirement = beginCartSessionRetirement(slug ?? '', {
    expectedEpoch: startedEpoch,
  });
  let ran = false;
  let succeeded = false;
  let replayOperationId = outcome?.operationId;
  let abort!: () => void;
  const canceled = new Promise<T>((resolve) => {
    abort = () => {
      retirement.release();
      resolve(blocked);
    };
    outcome?.signal?.addEventListener('abort', abort, { once: true });
    if (outcome?.signal?.aborted) abort();
  });
  const work = retirement.drained.then(
    async () => {
      if (outcome?.signal?.aborted) return blocked;
      ran = true;
      const result = await operation();
      succeeded = outcome?.isSuccessful(result) ?? true;
      if (outcome?.canRetry?.(result) === false) replayOperationId = undefined;
      return result;
    },
    () => blocked
  );
  const pending = Promise.race([work, canceled]).finally(() => {
    retirement.release();
    outcome?.signal?.removeEventListener('abort', abort);
    flights.delete(pending);
    if (
      (!succeeded || outcome?.signal?.aborted) &&
      (ran || getCartCookieEpoch(slug) !== startedEpoch)
    )
      bumpCartSessionGeneration({
        merchantSlug: slug,
        operationId: ran ? replayOperationId : undefined,
      });
  });
  flights.set(pending, slug ?? '');
  return pending;
}

export function runBoundedCartSessionWrite<T>(
  slug: string | null | undefined,
  fallback: T,
  operation: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
  beforeLock?: (signal: AbortSignal) => Promise<boolean>
): Promise<T> {
  if (beforeLock) {
    const startedEpoch = getCartCookieEpoch(slug);
    return withCartRequestDeadline(
      fallback,
      async (requestSignal) => {
        if (!(await beforeLock(requestSignal))) return fallback;
        if (!isCartCookieEpochCurrent(startedEpoch, slug)) return fallback;
        return runBoundedCartSessionWrite(
          slug,
          fallback,
          operation,
          requestSignal
        );
      },
      signal
    );
  }
  return runCartSessionWrite(slug, fallback, () =>
    withCartRequestDeadline(
      fallback,
      (requestSignal) =>
        withCartCookieWrite(
          fallback,
          requestSignal,
          () => operation(requestSignal),
          slug
        ),
      signal
    )
  );
}
