import 'server-only';

// Server-only per-connection token cache. One instance per resolved
// connection (merchant/account/environment): sharing an instance across
// merchants is forbidden. The cache never imports the transport; `login` is
// injected with `baseUrl` (and provider identity) pinned per key in its
// closure. No logging; the caller decides.
export interface OxygenTokenCacheKey {
  accountLabel: string;
  environment: string;
}

export interface OxygenTokenCredentials {
  secret: string;
}

export interface OxygenTokenLoginResult {
  token: string;
  expiresAtMs: number;
}

export type OxygenTokenLogin = (
  key: OxygenTokenCacheKey,
  credentials: OxygenTokenCredentials
) => Promise<OxygenTokenLoginResult>;

export interface OxygenTokenCacheDeps {
  login: OxygenTokenLogin;
  // Single injected time source (default Date.now); composition must pass the
  // same instance the transport uses — disagreeing clocks corrupt freshness.
  now?: () => number;
  expirySkewMs?: number;
}

export class OxygenTokenCacheError extends Error {
  readonly code: 'invalid_key';

  constructor() {
    super('Invalid Oxygen token cache key.');
    this.name = 'OxygenTokenCacheError';
    this.code = 'invalid_key';
  }
}

export interface OxygenTokenCache {
  getToken(
    key: OxygenTokenCacheKey,
    credentials: OxygenTokenCredentials
  ): Promise<OxygenTokenLoginResult>;
  invalidate(key: OxygenTokenCacheKey): void;
}

interface CacheEntry {
  token: string;
  expiresAtMs: number;
  storedAtMs: number;
}

const DEFAULT_EXPIRY_SKEW_MS = 60_000;

function isKeyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() !== '';
}

function assertValidKey(key: OxygenTokenCacheKey): void {
  if (
    typeof key !== 'object' ||
    key === null ||
    !isKeyString(key.accountLabel) ||
    !isKeyString(key.environment)
  ) {
    throw new OxygenTokenCacheError();
  }
}

export function createOxygenTokenCache(
  deps: OxygenTokenCacheDeps
): OxygenTokenCache {
  const { login, now = Date.now, expirySkewMs = DEFAULT_EXPIRY_SKEW_MS } = deps;
  // Fail fast on misconfiguration: a non-finite skew breaks freshness math
  // (perpetual miss) and a negative skew would serve expired tokens.
  if (
    typeof expirySkewMs !== 'number' ||
    !Number.isFinite(expirySkewMs) ||
    expirySkewMs < 0
  ) {
    throw new Error('Invalid Oxygen token cache configuration.');
  }
  // Nested Maps (never joined strings) so separator/unicode content in labels
  // cannot collide; comparison is exact (case/whitespace significant).
  const entries = new Map<string, Map<string, CacheEntry>>();
  const flights = new Map<
    string,
    Map<string, Promise<OxygenTokenLoginResult>>
  >();

  function getInner<V>(
    outer: Map<string, Map<string, V>>,
    environment: string
  ) {
    return outer.get(environment);
  }

  function getOrCreateInner<V>(
    outer: Map<string, Map<string, V>>,
    environment: string
  ) {
    let inner = outer.get(environment);
    if (!inner) {
      inner = new Map<string, V>();
      outer.set(environment, inner);
    }
    return inner;
  }

  function getFlight(key: OxygenTokenCacheKey) {
    return getInner(flights, key.environment)?.get(key.accountLabel);
  }

  function isFresh(entry: CacheEntry, nowMs: number): boolean {
    const lifetimeMs = entry.expiresAtMs - entry.storedAtMs;
    // Clamp keeps sub-skew tokens briefly usable instead of login-storming;
    // the floor at 0 keeps already-spent lifetimes fail-closed.
    const effectiveSkew = Math.max(
      0,
      Math.min(expirySkewMs, Math.floor(lifetimeMs / 2))
    );
    return nowMs < entry.expiresAtMs - effectiveSkew;
  }

  async function getToken(
    suppliedKey: OxygenTokenCacheKey,
    credentials: OxygenTokenCredentials
  ): Promise<OxygenTokenLoginResult> {
    assertValidKey(suppliedKey);
    // Pin identity before awaiting: caller/adapter mutation must never move a
    // flight or prevent its cleanup. Give the adapter its own separate copy.
    const key = {
      accountLabel: suppliedKey.accountLabel,
      environment: suppliedKey.environment,
    };
    const freshCheckMs = now();
    const entry = getInner(entries, key.environment)?.get(key.accountLabel);
    if (entry && isFresh(entry, freshCheckMs)) {
      return { token: entry.token, expiresAtMs: entry.expiresAtMs };
    }
    const inFlight = getFlight(key);
    if (inFlight) {
      // Per-awaiter copy: joiners share one flight but must not share one
      // mutable result object.
      return inFlight.then((result) => ({ ...result }));
    }
    let resolveFlight!: (value: OxygenTokenLoginResult) => void;
    let rejectFlight!: (reason: unknown) => void;
    const flight = new Promise<OxygenTokenLoginResult>((resolve, reject) => {
      resolveFlight = resolve;
      rejectFlight = reject;
    });
    getOrCreateInner(flights, key.environment).set(key.accountLabel, flight);
    // `login` runs inside the async closure so a synchronous throw becomes a
    // rejection: failed logins are never stored and always clear the flight.
    // The closure is catch-all, so awaiting `flight` below is the only branch
    // and no unhandled rejection can escape from here.
    void (async () => {
      try {
        const result = await login({ ...key }, credentials);
        // Detached flights (post-invalidate) resolve for their own awaiters
        // but must not clobber newer state.
        if (getFlight(key) === flight) {
          getOrCreateInner(entries, key.environment).set(key.accountLabel, {
            token: result.token,
            expiresAtMs: result.expiresAtMs,
            storedAtMs: now(),
          });
        }
        resolveFlight({ token: result.token, expiresAtMs: result.expiresAtMs });
      } catch (error) {
        rejectFlight(error);
      }
    })();
    try {
      const result = await flight;
      return { ...result };
    } finally {
      if (getFlight(key) === flight) {
        getInner(flights, key.environment)?.delete(key.accountLabel);
      }
    }
  }

  function invalidate(key: OxygenTokenCacheKey): void {
    assertValidKey(key);
    // Drop the stored entry AND detach the flight: pre-invalidate awaiters
    // still resolve (documented); post-invalidate callers start a new login.
    getInner(entries, key.environment)?.delete(key.accountLabel);
    getInner(flights, key.environment)?.delete(key.accountLabel);
  }

  return { getToken, invalidate };
}
