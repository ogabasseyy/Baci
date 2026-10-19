'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CustomerSavingsDraftJourney } from '@/components/storefront/customer-savings-drafts/customer-savings-draft-journey';
import { useCustomerAuth } from '@/contexts/customer-auth-context';

export function LocalSavingsWallet({
  merchantId,
  merchantSlug,
}: {
  merchantId: string;
  merchantSlug: string;
}) {
  const { user, isAuthenticated, isLoading, logout } = useCustomerAuth();
  if (isLoading) return <p role="status">Loading your local wallet…</p>;
  if (!isAuthenticated || !user) {
    const returnTo = `/${merchantSlug}/wallet`;
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-10">
        <h2 className="text-2xl font-semibold">Your wallet and savings</h2>
        <p>
          Local test only. Sign in with customer@savings.local.test. No real
          money is used.
        </p>
        <Link
          className="inline-flex rounded-lg bg-[var(--store-primary)] px-5 py-3 text-[var(--store-primary-text)]"
          href={`/${merchantSlug}/account/login?redirect=${encodeURIComponent(returnTo)}`}
        >
          Sign in to test savings
        </Link>
      </div>
    );
  }
  return (
    <AuthenticatedWallet
      key={`${user.id}:${merchantId}`}
      merchantId={merchantId}
      userId={user.id}
      logout={logout}
    />
  );
}

function AuthenticatedWallet({
  merchantId,
  userId,
  logout,
}: {
  merchantId: string;
  userId: string;
  logout: () => Promise<void>;
}) {
  const [showSavings, setShowSavings] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  async function signOut() {
    setLogoutError(false);
    try {
      await logout();
    } catch {
      setLogoutError(true);
    }
  }
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 text-[var(--store-text)]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-2xl font-semibold">Your wallet and savings</h2>
        <button
          type="button"
          className="rounded-lg border px-4 py-2"
          onClick={() => void signOut()}
        >
          Sign out
        </button>
      </div>
      <p>
        Local test · Real local sign-in and saved drafts. Funding, interest and
        purchases are not enabled.
      </p>
      {logoutError && <p role="alert">Sign-out failed. Please try again.</p>}
      {showSavings ? (
        <CustomerSavingsDraftJourney merchantId={merchantId} userId={userId} />
      ) : (
        <button
          type="button"
          className="rounded-lg bg-[var(--store-primary)] px-5 py-3 text-[var(--store-primary-text)]"
          onClick={() => setShowSavings(true)}
        >
          Start saving
        </button>
      )}
    </div>
  );
}
