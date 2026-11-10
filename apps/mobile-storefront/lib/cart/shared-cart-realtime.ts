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
const MAX_TTL_MS = 301000;

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
  function refresh(): void {
    void options.refresh().catch(() => undefined);
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
      const ttl = access
        ? Date.parse(access.expiresAt) - Date.now()
        : Number.NaN;
      if (
        !live(run) ||
        !access ||
        access.topic !== `cart:${options.merchantId}:${cartId}` ||
        !Number.isFinite(ttl) ||
        ttl < 1000 ||
        ttl > MAX_TTL_MS
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
          highestHint = event.version;
          refresh();
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
      connectedCartId = cartId;
      timer = setTimeout(
        () => void connect(),
        Math.max(0, ttl - Math.min(30000, ttl / 5))
      );
    } catch {
      if (live(run)) timer = setTimeout(() => void connect(), RETRY_MS);
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
      void connect();
    },
    stop() {
      alive = false;
      appState.remove();
      void disconnect();
    },
  };
}
