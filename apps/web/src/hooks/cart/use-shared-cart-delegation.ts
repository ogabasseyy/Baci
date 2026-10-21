'use client';

import { useEffect, useState } from 'react';
import { isCartCrossTabLockSupported } from './cart-cross-tab-lock';
import {
  getCartSessionGeneration,
  subscribeCartSessionGeneration,
} from './shared-cart-storage';
import { useSharedCart } from './use-shared-cart';

/**
 * Shared-cart delegation wiring for the storefront cart provider: the
 * fenced session generation, the per-merchant delegation decision and
 * the delegated cart itself. Extracted so the provider file stays
 * focused on the legacy cart it still owns directly.
 */
export function useSharedCartDelegation(input: {
  sharedCartEnabled: boolean;
  sharedCartRealtimeEnabled: boolean;
  merchantId: string | null;
  merchantSlug: string | null;
  initialMerchantSlug: string | null;
}) {
  // Fences the shared-cart session: bumped on every merchant/slug change
  // so late responses from the previous merchant never touch the new cart.
  const [sessionGeneration, setSessionGeneration] = useState(1);
  // Compare this merchant's actual generation snapshot instead of the
  // cached last change: a bump for another merchant must not restart
  // this merchant's link lifecycle and discard its queued commands.
  useEffect(() => {
    let lastSeen = getCartSessionGeneration(input.merchantSlug);
    return subscribeCartSessionGeneration(() => {
      const current = getCartSessionGeneration(input.merchantSlug);
      if (current === lastSeen) return;
      lastSeen = current;
      setSessionGeneration((generation) => generation + 1);
    });
  }, [input.merchantSlug]);
  function bumpSessionGeneration() {
    setSessionGeneration((generation) => generation + 1);
  }

  // Delegation is per-merchant: enrollment binds merchantId to the slug
  // the frame served, so switching away falls back to that slug's legacy
  // cart instead of showing another merchant's server cart. Browsers
  // that cannot coordinate tabs (secure context without Web Locks)
  // stay on the legacy device cart rather than failing every write.
  const delegated =
    input.sharedCartEnabled &&
    isCartCrossTabLockSupported() &&
    input.merchantId !== null &&
    input.initialMerchantSlug !== null &&
    input.merchantSlug === input.initialMerchantSlug;
  const shared = useSharedCart({
    enabled: delegated,
    realtimeEnabled: delegated && input.sharedCartRealtimeEnabled,
    merchantId: input.merchantId ?? '',
    merchantSlug: input.merchantSlug,
    sessionGeneration,
  });

  return { bumpSessionGeneration, delegated, sessionGeneration, shared };
}
