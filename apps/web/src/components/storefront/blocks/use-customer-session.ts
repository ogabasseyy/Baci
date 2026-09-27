'use client';

import { useEffect, useState } from 'react';

export interface CustomerSession {
  authenticated: boolean;
  customer: { first_name: string; last_name: string; email: string } | null;
}

/**
 * Customer auth state for the storefront header. A simple fetch approach
 * (extracted verbatim from Header) since context may not be available.
 * Single instance per header: both the desktop account menu and the mobile
 * overlay read the returned session, so the check runs once.
 */
export function useCustomerSession({
  showAccount,
  merchantSlug,
  isPreview,
}: {
  showAccount: boolean;
  merchantSlug: string | undefined;
  isPreview: boolean;
}) {
  const [customerSession, setCustomerSession] =
    useState<CustomerSession | null>(null);

  useEffect(() => {
    if (!showAccount || !merchantSlug || isPreview) return;

    const checkSession = async () => {
      try {
        const response = await fetch(
          `/api/storefront/auth/session?merchantSlug=${encodeURIComponent(merchantSlug)}`
        );
        const data = await response.json();
        setCustomerSession({
          authenticated: data.authenticated || false,
          customer: data.customer || null,
        });
      } catch {
        setCustomerSession({ authenticated: false, customer: null });
      }
    };

    checkSession();
  }, [showAccount, merchantSlug, isPreview]);

  const handleLogout = async () => {
    try {
      await fetch('/api/storefront/auth/logout', { method: 'POST' });
      setCustomerSession({ authenticated: false, customer: null });
      window.location.href = '/';
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return { customerSession, handleLogout };
}
