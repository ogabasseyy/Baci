'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthSafe } from '@/contexts/auth-context';
import { asRoute } from '@/lib/routes';
import { createClient } from '@/lib/supabase/client';
import { useCartDrawerLifecycle } from './use-cart-drawer-lifecycle';

const AUTH_LOOKUP_TIMEOUT_MS = 5000;

/**
 * Coordinates checkout auth lookup and navigation while delegating drawer
 * loading/close transitions to `useCartDrawerLifecycle` so the drawer remains
 * open with its spinner until the destination route commits.
 */
export function useCartCheckout(
  isCartOpen: boolean,
  setIsCartOpen: (open: boolean) => void,
  checkoutUrl: string
) {
  const auth = useAuthSafe();
  const router = useRouter();
  const {
    isCheckoutLoading,
    setIsCheckoutLoading,
    checkoutError,
    setCheckoutError,
  } = useCartDrawerLifecycle({ isCartOpen, setIsCartOpen });
  const [isIdentityOpen, setIsIdentityOpen] = useState(false);
  const attempt = useRef(0);

  useEffect(() => {
    if (!isCartOpen) {
      attempt.current += 1;
      setIsIdentityOpen(false);
    }
    return () => {
      attempt.current += 1;
    };
  }, [isCartOpen]);

  const closeCart = () => {
    attempt.current += 1;
    setIsCheckoutLoading(false);
    setIsIdentityOpen(false);
    setCheckoutError(null);
    setIsCartOpen(false);
  };

  const handleCheckout = async () => {
    const currentAttempt = ++attempt.current;
    setIsCheckoutLoading(true);
    setCheckoutError(null);
    let signedIn = Boolean(auth?.user);
    if (!signedIn) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        signedIn = await Promise.race([
          createClient()
            .auth.getUser()
            .then((result) => !result.error && Boolean(result.data.user)),
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), AUTH_LOOKUP_TIMEOUT_MS);
          }),
        ]);
      } catch {
        signedIn = false;
      } finally {
        clearTimeout(timer);
      }
    }
    if (currentAttempt !== attempt.current) return;
    if (!signedIn) {
      setIsCheckoutLoading(false);
      setIsIdentityOpen(true);
      return;
    }
    try {
      router.push(asRoute(checkoutUrl));
    } catch {
      setIsCheckoutLoading(false);
      setCheckoutError('Unable to proceed to checkout. Please try again.');
    }
  };

  return {
    closeCart,
    handleCheckout,
    isCheckoutLoading,
    isIdentityOpen,
    setIsIdentityOpen,
    checkoutError,
  };
}
