'use client';

import type { User } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { CHECKOUT_AUTH_CHANGED } from '@/components/storefront/checkout-auth-notification';
import { createClient } from '@/lib/supabase/client';

/** Checkout may render outside AuthProvider; read the shared session directly. */
export function useCheckoutSessionUser() {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const client = createClient();
    async function refresh() {
      const current = ++revision;
      try {
        const { data, error } = await client.auth.getUser();
        if (active && current === revision) setUser(error ? null : data.user);
      } catch {
        if (active && current === revision) setUser(null);
      }
    }
    void refresh();
    const { data: { subscription } } = client.auth.onAuthStateChange(() => { void refresh(); });
    window.addEventListener(CHECKOUT_AUTH_CHANGED, refresh);
    return () => {
      active = false;
      revision++;
      window.removeEventListener(CHECKOUT_AUTH_CHANGED, refresh);
      subscription.unsubscribe();
    };
  }, []);
  return user;
}
