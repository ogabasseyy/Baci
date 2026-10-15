'use client';
import { readCartChangeEvent, shouldRefreshCart } from '@baci/shared/cart';
import { useEffect, useRef, useState } from 'react';
import {
  type CartReceiveConnection,
  type CartSubscriptionDeps,
  cartSubscriptionDeps,
} from './cart-realtime-client';

export interface CartSubscriptionOptions {
  enabled: boolean;
  merchantId: string;
  merchantSlug: string | null;
  cartId: string | null;
  version: number;
  generation: number;
  onRefresh: () => Promise<void>;
}

/** Notifications only request an authorized refetch; they never edit UI lines. */
export function useCartSubscription(
  options: CartSubscriptionOptions,
  deps: CartSubscriptionDeps = cartSubscriptionDeps
): boolean {
  const [connected, setConnected] = useState(false);
  const latest = useRef(options);
  latest.current = options;
  // biome-ignore lint/correctness/useExhaustiveDependencies: refs supply current actions/version; transport identity owns the connection.
  useEffect(() => {
    setConnected(false);
    if (!options.enabled || !options.cartId) return;
    let alive = true;
    let epoch = 0;
    let connection: CartReceiveConnection | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
    let highestHint = options.version;
    let retryDelay = 1000;
    let fetching = false;
    let pending = false;
    const identity = { merchantId: options.merchantId, cartId: options.cartId };
    function isLive(): boolean {
      const current = latest.current;
      return (
        alive &&
        current.enabled &&
        current.generation === options.generation &&
        current.merchantId === identity.merchantId &&
        current.cartId === identity.cartId
      );
    }
    async function refresh(): Promise<void> {
      if (!isLive() || document.visibilityState === 'hidden') return;
      if (fetching) {
        pending = true;
        return;
      }
      clearTimeout(retryTimer);
      fetching = true;
      try {
        await latest.current.onRefresh();
      } catch {
        if (alive) setConnected(false);
      } finally {
        fetching = false;
        if (alive && pending) {
          pending = false;
          void refresh();
        } else if (isLive() && highestHint > latest.current.version) {
          // A resolved refresh may still have failed to fetch/adopt a snapshot.
          // Keep the committed hint pending until the reducer catches up.
          retryTimer = setTimeout(() => {
            if (isLive() && highestHint > latest.current.version)
              void refresh();
          }, retryDelay);
          retryDelay = Math.min(15000, retryDelay * 2);
        } else {
          retryDelay = 1000;
        }
      }
    }
    async function stop(): Promise<void> {
      epoch += 1;
      clearTimeout(timer);
      clearTimeout(retryTimer);
      const old = connection;
      connection = null;
      if (alive) setConnected(false);
      if (old) {
        try {
          await old.disconnect();
        } catch {
          /* Recovery remains HTTP based. */
        }
      }
    }
    async function connect(): Promise<void> {
      const stopped = stop();
      const run = epoch;
      await stopped;
      if (!isLive() || run !== epoch || document.visibilityState === 'hidden')
        return;
      try {
        const access = await deps.loadAccess(options.merchantSlug);
        if (
          !alive ||
          run !== epoch ||
          !access ||
          access.topic !== `cart:${identity.merchantId}:${identity.cartId}`
        )
          return;
        const ttl = Date.parse(access.expiresAt) - Date.now();
        if (!Number.isFinite(ttl) || ttl < 1000 || ttl > 301000) return;
        const joined = await deps.connect(
          access,
          (value) => {
            if (!isLive() || run !== epoch) return;
            const event = readCartChangeEvent(value);
            if (
              !event ||
              !shouldRefreshCart(
                Math.max(latest.current.version, highestHint),
                event,
                identity
              )
            )
              return;
            highestHint = event.version;
            void refresh();
          },
          (joined) => {
            if (!isLive() || run !== epoch) return;
            setConnected(joined);
            // A join/rejoin can race a mutation before the first hint: always fetch.
            if (joined) void refresh();
          }
        );
        if (!isLive() || run !== epoch) {
          await joined.disconnect();
          return;
        }
        connection = joined;
        const remaining = Date.parse(access.expiresAt) - Date.now();
        timer = setTimeout(
          () => {
            void connect();
          },
          Math.max(0, remaining - Math.min(30000, ttl / 5))
        );
      } catch {
        if (isLive() && run === epoch) {
          setConnected(false);
          timer = setTimeout(() => {
            void connect();
          }, 15000);
        }
      }
    }
    function visibility(): void {
      clearTimeout(hiddenTimer);
      if (document.visibilityState === 'hidden')
        hiddenTimer = setTimeout(() => {
          void stop();
        }, 60000);
      else if (!connection) void connect();
      else if (highestHint > latest.current.version) void refresh();
    }
    document.addEventListener('visibilitychange', visibility);
    void connect();
    return () => {
      alive = false;
      clearTimeout(hiddenTimer);
      clearTimeout(retryTimer);
      document.removeEventListener('visibilitychange', visibility);
      void stop();
    };
    // Mutable refs provide fresh versions/actions without reconnecting per edit.
  }, [
    options.enabled,
    options.merchantId,
    options.merchantSlug,
    options.cartId,
    deps,
    options.generation,
  ]);
  return connected;
}
