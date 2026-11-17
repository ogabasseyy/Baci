'use client';

import { useEffect, useLayoutEffect } from 'react';
import type { Customer, CustomerUser } from './customer-auth-context';
import { loadCustomerSession } from './customer-auth-session';
import { publishCustomerIdentity } from './customer-live-identity';

interface UseCustomerAuthLifecycleParams {
  merchantSlug: string;
  user: CustomerUser | null;
  setUser: (user: CustomerUser | null) => void;
  setCustomer: (customer: Customer | null) => void;
  setIsLoading: (loading: boolean) => void;
}

export function useCustomerAuthLifecycle({
  merchantSlug,
  user,
  setUser,
  setCustomer,
  setIsLoading,
}: UseCustomerAuthLifecycleParams) {
  const checkSession = () =>
    loadCustomerSession(
      merchantSlug,
      {
        currentUserId: user?.id,
        setUser,
        setCustomer,
        setIsLoading,
      },
      undefined,
      { bypassSessionHint: true }
    );

  // Publish the storefront reset commit-synchronously (Codex R129
  // P2, R133 P2): a layout effect leaves no post-commit window in
  // which a settling promise continuation could read the previous
  // storefront's identity and publish the old store's result into
  // the newly committed view.
  useLayoutEffect(() => {
    publishCustomerIdentity(null, null, merchantSlug);
  }, [merchantSlug]);

  useEffect(() => {
    let cancelled = false;

    void loadCustomerSession(
      merchantSlug,
      { setUser, setCustomer, setIsLoading },
      () => cancelled
    );

    return () => {
      cancelled = true;
    };
  }, [merchantSlug, setCustomer, setIsLoading, setUser]);

  const refreshCustomer = async () => {
    if (!user) return;
    await checkSession();
  };

  return { checkSession, refreshCustomer };
}
