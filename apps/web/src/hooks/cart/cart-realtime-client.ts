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

/**
 * `@supabase/supabase-js` is loaded only when a receive connection opens, and
 * public NEXT_PUBLIC_SUPABASE_* values are read directly so the cart provider
 * never pulls `@/env` (zod) or `@supabase/supabase-js` into initial `<head>` JS.
 */
async function loadRealtimeClientDeps() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Cart receive connection unavailable');
  }
  try {
    const { createClient } = await import('@supabase/supabase-js');
    return { createClient, supabaseAnonKey, supabaseUrl };
  } catch {
    throw new Error('Cart receive connection unavailable');
  }
}

/** Isolated, nonpersistent client: shopper/account credentials are never replaced. */
export async function openCartReceiveConnection(
  access: CartReceiveAccess,
  onEvent: (value: unknown) => void,
  onStatus: (joined: boolean) => void
): Promise<CartReceiveConnection> {
  const { createClient, supabaseAnonKey, supabaseUrl } =
    await loadRealtimeClientDeps();
  const client = createClient(supabaseUrl, supabaseAnonKey, {
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
