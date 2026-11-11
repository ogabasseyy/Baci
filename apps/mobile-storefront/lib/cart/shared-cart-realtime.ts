import { readCartChangeEvent, shouldRefreshCart } from '@baci/shared/cart';
import { AppState } from 'react-native';

export interface CartReceiveAccess {
  topic: string;
  token: string;
  expiresAt: string;
}
export interface CartReceiveConnection {
  disconnect(): Promise<void>;
}
export interface SharedCartRealtimeDeps {
  loadAccess(): Promise<CartReceiveAccess | null>;
  connect(
    access: CartReceiveAccess,
    onEvent: (value: unknown) => void,
    onStatus: (joined: boolean) => void
  ): Promise<CartReceiveConnection>;
}
export interface SharedCartRealtimeOptions {
  merchantId: string;
  getCartId(): string | null;
  getVersion(): number;
  isCurrent(): boolean;
  refresh(): Promise<void>;
}

const RETRY_MS = 15000;
/** The server caps a grant near 300s; beyond this the grant is not trusted at all. */
const MAX_TTL_MS = 301000;
const IMPLAUSIBLE_TTL_MS = 3600000;

/**
 * Push channel for the native shared cart. A broadcast is only a hint to run
 * the normal authorized refresh; it never edits the displayed lines. Any
 * failure leaves the 30s poll and foreground refresh as the safety net.
 */
export function startSharedCartRealtime(
  options: SharedCartRealtimeOptions,
  deps: SharedCartRealtimeDeps
): { sync(): void; stop(): void } {
  let alive = true;
  let epoch = 0;
  let connection: CartReceiveConnection | null = null;
  let connectedCartId: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let highestHint = 0;
  let failures = 0;
  let inFlight = false;
  let queued: { hint?: number; any: boolean; cart: string | null } | null =
    null;

  const live = (run: number) =>
    alive && run === epoch && options.isCurrent() && isForeground();
  function isForeground(): boolean {
    return AppState.currentState === 'active';
  }
  async function disconnect(): Promise<void> {
    epoch += 1;
    clearTimeout(timer);
    const old = connection;
    connection = null;
    connectedCartId = null;
    try {
      await old?.disconnect();
    } catch {
      /* Recovery stays HTTP based. */
    }
  }
  /** One refresh at a time; hints that arrive meanwhile collapse into at most one follow-up. */
  function refresh(hint?: number): void {
    if (inFlight) {
      queued = {
        hint:
          hint === undefined ? undefined : Math.max(hint, queued?.hint ?? 0),
        any: (queued?.any ?? false) || hint === undefined,
        cart: options.getCartId(),
      };
      return;
    }
    inFlight = true;
    const originCart = options.getCartId();
    void options
      .refresh()
      .then(() => {
        // Remember a hint only once it was fetched, so a failed fetch lets
        // the next broadcast at the same version try again.
        if (hint !== undefined && options.getCartId() === originCart)
          highestHint = Math.max(highestHint, hint);
      })
      .catch(() => undefined)
      .then(() => {
        inFlight = false;
        const next = queued;
        queued = null;
        if (
          alive &&
          next &&
          next.cart === options.getCartId() &&
          (next.any ||
            (next.hint ?? 0) > Math.max(options.getVersion(), highestHint))
        )
          refresh(next.hint);
      });
  }
  async function connect(): Promise<void> {
    // Take the epoch before yielding, or an overlapping connect would adopt
    // the newer one's and both would stay live.
    const closing = disconnect();
    const run = epoch;
    await closing;
    const cartId = options.getCartId();
    if (!cartId || !live(run)) return;
    try {
      const access = await deps.loadAccess();
      const rawTtl = access
        ? Date.parse(access.expiresAt) - Date.now()
        : Number.NaN;
      // A device clock behind the server's makes a valid grant look longer; clamp.
      const ttl = Math.min(rawTtl, MAX_TTL_MS);
      if (
        !live(run) ||
        !access ||
        access.topic.toLowerCase() !==
          `cart:${options.merchantId}:${cartId}`.toLowerCase() ||
        !Number.isFinite(rawTtl) ||
        ttl < 1000 ||
        rawTtl > IMPLAUSIBLE_TTL_MS
      )
        return;
      const identity = { merchantId: options.merchantId, cartId };
      const joined = await deps.connect(
        access,
        (value) => {
          if (!live(run)) return;
          const event = readCartChangeEvent(value);
          if (
            !event ||
            !shouldRefreshCart(
              Math.max(options.getVersion(), highestHint),
              event,
              identity
            )
          )
            return;
          refresh(event.version);
        },
        (isJoined) => {
          // A join can race a mutation before the first hint: always fetch.
          if (isJoined && live(run)) refresh();
        }
      );
      if (!live(run)) {
        await joined.disconnect().catch(() => undefined);
        return;
      }
      connection = joined;
      failures = 0;
      connectedCartId = cartId;
      timer = setTimeout(
        () => void connect(),
        Math.max(0, ttl - Math.min(30000, ttl / 5))
      );
    } catch {
      if (live(run)) {
        // Back off (with jitter after the first retry) so an outage or a
        // permanent failure does not hammer the grant endpoint.
        const wait = Math.min(RETRY_MS * 2 ** failures, 300000);
        timer = setTimeout(
          () => void connect(),
          failures ? wait * (0.75 + Math.random() / 2) : wait
        );
        failures += 1;
      }
    }
  }
  const appState = AppState.addEventListener('change', (state) => {
    if (!alive) return;
    if (state === 'active') void connect();
    else void disconnect();
  });
  void connect();
  return {
    sync() {
      const cartId = options.getCartId();
      if (!alive || (cartId === connectedCartId && connection)) return;
      highestHint = 0;
      queued = null;
      void connect();
    },
    stop() {
      alive = false;
      appState.remove();
      void disconnect();
    },
  };
}
