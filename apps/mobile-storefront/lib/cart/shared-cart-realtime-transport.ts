import { createClient } from '@supabase/supabase-js';
import { getSupabaseRealtimeConfig } from '@/lib/supabase';
import { NativeCartError } from './native-cart-error';
import { readOwnedCartProof } from './owned-session';
import { type CartSessionStorage, cartSessionStorage } from './session-storage';
import type { CartFetch } from './shared-cart-client';
import type {
  CartReceiveAccess,
  CartReceiveConnection,
  SharedCartRealtimeDeps,
} from './shared-cart-realtime';

const proofPattern = /^cp1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function createNativeRealtimeDeps(config: {
  merchantId: string;
  merchantSlug: string;
  apiOrigin: string;
  ownerSubject?: string;
  storage?: CartSessionStorage;
  fetcher?: CartFetch;
}): SharedCartRealtimeDeps {
  const storage = config.storage ?? cartSessionStorage;
  const fetcher: CartFetch =
    config.fetcher ?? ((url, init) => fetch(url, init));
  return {
    async loadAccess(): Promise<CartReceiveAccess | null> {
      const proof = await readOwnedCartProof(
        storage,
        config.merchantId.toLowerCase(),
        config.ownerSubject
      );
      if (!proof || !proofPattern.test(proof)) return null;
      const origin = new URL(config.apiOrigin).origin;
      const response = await fetcher(
        `${origin}/api/storefront/cart/realtime?merchantSlug=${encodeURIComponent(config.merchantSlug)}`,
        {
          method: 'GET',
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
          headers: { Authorization: `Bearer ${proof}` },
        }
      );
      if (response.status >= 500 || response.status === 429)
        throw new NativeCartError('temporarily_unavailable');
      if (!response.ok) return null;
      const value: unknown = await response.json();
      if (typeof value !== 'object' || value === null) return null;
      const grant = value as Record<string, unknown>;
      if (
        typeof grant.topic !== 'string' ||
        typeof grant.token !== 'string' ||
        !grant.token ||
        typeof grant.expiresAt !== 'string'
      )
        return null;
      return {
        topic: grant.topic,
        token: grant.token,
        expiresAt: grant.expiresAt,
      };
    },
    async connect(access, onEvent, onStatus): Promise<CartReceiveConnection> {
      const project = getSupabaseRealtimeConfig();
      if (!project) throw new Error('Cart receive connection unavailable');
      // Isolated, nonpersistent client: shopper Auth credentials are never replaced.
      const client = createClient(project.url, project.key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
      try {
        await client.realtime.setAuth(access.token);
        const channel = client
          .channel(access.topic, {
            config: { private: true, broadcast: { self: false } },
          })
          .on('broadcast', { event: 'cart_changed' }, (message) =>
            onEvent(message.payload)
          )
          .subscribe((status) => onStatus(status === 'SUBSCRIBED'));
        return {
          disconnect: async () => {
            await client.removeChannel(channel);
            client.realtime.disconnect();
          },
        };
      } catch {
        client.realtime.disconnect();
        throw new Error('Cart receive connection unavailable');
      }
    },
  };
}
