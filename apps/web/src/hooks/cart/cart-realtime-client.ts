import { createClient } from '@supabase/supabase-js';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/env';

export interface CartReceiveAccess {
  topic: string;
  token: string;
  expiresAt: string;
}
export interface CartReceiveConnection {
  disconnect(): Promise<void>;
}
export interface CartSubscriptionDeps {
  loadAccess: (slug: string | null) => Promise<CartReceiveAccess | null>;
  connect: (
    access: CartReceiveAccess,
    onEvent: (value: unknown) => void,
    onStatus: (joined: boolean) => void
  ) => Promise<CartReceiveConnection>;
}

export async function loadCartReceiveAccess(
  slug: string | null
): Promise<CartReceiveAccess | null> {
  const query = slug ? `?merchantSlug=${encodeURIComponent(slug)}` : '';
  const response = await fetch(`/api/storefront/cart/realtime${query}`, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (response.status >= 500 || response.status === 429) {
    throw new Error('Cart receive access temporarily unavailable');
  }
  if (!response.ok) return null;
  const value: unknown = await response.json();
  if (typeof value !== 'object' || value === null) return null;
  const access = value as Record<string, unknown>;
  if (
    typeof access.topic !== 'string' ||
    typeof access.token !== 'string' ||
    !access.token ||
    typeof access.expiresAt !== 'string'
  )
    return null;
  return {
    topic: access.topic,
    token: access.token,
    expiresAt: access.expiresAt,
  };
}

/** Isolated, nonpersistent client: shopper/account credentials are never replaced. */
export async function openCartReceiveConnection(
  access: CartReceiveAccess,
  onEvent: (value: unknown) => void,
  onStatus: (joined: boolean) => void
): Promise<CartReceiveConnection> {
  const client = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
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
}
export const cartSubscriptionDeps: CartSubscriptionDeps = {
  loadAccess: loadCartReceiveAccess,
  connect: openCartReceiveConnection,
};
