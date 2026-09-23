import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getConfiguredAgenticMerchantSlug } from '@/lib/agentic/agentic-merchant-slug';
import { getMerchantForUser } from '@/lib/merchant-server';
import { DashboardProviders } from './providers';

const TRUSTED_NONCE_PATTERN = /^[\w-]{16,128}$/;

function getTrustedRequestNonce(headersList: Headers): string | undefined {
  // proxy.ts overwrites x-nonce for protected routes before this Server
  // Component runs. Validate the value before passing it to CSP consumers.
  const nonce = headersList.get('x-nonce');
  return nonce && TRUSTED_NONCE_PATTERN.test(nonce) ? nonce : undefined;
}

export async function DashboardAuthGuard({
  children,
}: {
  children: ReactNode;
}) {
  const nonce = getTrustedRequestNonce(await headers());

  // Fetch merchant data server-side
  const { merchant, merchantLookupStatus, staffAccess, user } =
    await getMerchantForUser();

  // Server-side auth check - no race conditions!
  if (!user) {
    redirect('/login');
  }

  if (!merchant && merchantLookupStatus === 'error') {
    return (
      <div
        className="flex min-h-screen items-center justify-center px-6 text-center text-sm text-muted-foreground"
        role="alert"
      >
        We couldn&apos;t load your dashboard right now. Please refresh and try
        again.
      </div>
    );
  }

  // Only redirect to onboarding if user is NOT staff and has no merchant
  // Staff members should never see onboarding - they join existing merchants
  if (
    !merchant &&
    merchantLookupStatus === 'not_found' &&
    !staffAccess?.isStaff
  ) {
    redirect('/onboarding');
  }

  // Edge case: Staff with no merchant (shouldn't happen, but handle gracefully)
  if (!merchant && staffAccess?.isStaff) {
    console.error('[Dashboard] Staff user has no merchant:', user.id);
    redirect('/error?code=staff_no_merchant');
  }

  return (
    <DashboardProviders
      initialUser={user}
      initialMerchant={merchant}
      initialStaffAccess={staffAccess}
      agenticMerchantSlug={getConfiguredAgenticMerchantSlug() ?? null}
      nonce={nonce}
    >
      {children}
    </DashboardProviders>
  );
}
