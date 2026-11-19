'use client';

import { useAuthSafe } from '@/contexts/auth-context';
import { useCheckoutSessionUser } from './use-checkout-session-user';

/** Prefer the authenticated context while retaining the storefront session fallback. */
export function useCheckoutUser() {
  const auth = useAuthSafe();
  const sessionUser = useCheckoutSessionUser();
  return auth?.user ?? sessionUser;
}
