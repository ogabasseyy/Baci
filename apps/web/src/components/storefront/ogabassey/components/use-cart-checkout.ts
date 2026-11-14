'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthSafe } from '@/contexts/auth-context';
import { asRoute } from '@/lib/routes';
import { createClient } from '@/lib/supabase/client';

const AUTH_LOOKUP_TIMEOUT_MS = 5000;

/** Opens the identity choice if an authenticated session cannot be checked promptly. */
export function useCartCheckout(isCartOpen: boolean, setIsCartOpen: (open: boolean) => void, checkoutUrl: string) {
  const auth = useAuthSafe();
  const router = useRouter();
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [isIdentityOpen, setIsIdentityOpen] = useState(false);
  const attempt = useRef(0);

  useEffect(() => {
    if (!isCartOpen) {
      attempt.current += 1;
      setIsCheckoutLoading(false);
      setIsIdentityOpen(false);
    }
    return () => { attempt.current += 1; };
  }, [isCartOpen]);

  const closeCart = () => {
    attempt.current += 1;
    setIsCheckoutLoading(false);
    setIsIdentityOpen(false);
    setIsCartOpen(false);
  };

  const handleCheckout = async () => {
    const currentAttempt = ++attempt.current;
    setIsCheckoutLoading(true);
    let signedIn = Boolean(auth?.user);
    if (!signedIn) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        signedIn = await Promise.race([
          createClient().auth.getUser().then((result) => !result.error && Boolean(result.data.user)),
          new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), AUTH_LOOKUP_TIMEOUT_MS); }),
        ]);
      } catch {
        signedIn = false;
      } finally {
        clearTimeout(timer);
      }
    }
    if (currentAttempt !== attempt.current) return;
    setIsCheckoutLoading(false);
    if (!signedIn) {
      setIsIdentityOpen(true);
      return;
    }
    closeCart();
    router.push(asRoute(checkoutUrl));
  };

  return { closeCart, handleCheckout, isCheckoutLoading, isIdentityOpen, setIsIdentityOpen };
}
