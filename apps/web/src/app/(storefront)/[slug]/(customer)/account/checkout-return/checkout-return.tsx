'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useCustomerAuth } from '@/contexts/customer-auth-context';
import { asRoute } from '@/lib/routes';
import { isDomainIdentifier } from '@/lib/validation';

/** Resume only after the customer provider finishes account-switch reconciliation. */
export function CheckoutReturn({
  slug,
  next,
}: {
  slug: string;
  next?: string;
}) {
  const { isLoading, isAuthenticated } = useCustomerAuth();
  const router = useRouter();
  const [invalidDestination, setInvalidDestination] = useState(false);
  const basePath =
    slug && !isDomainIdentifier(slug) ? `/${encodeURIComponent(slug)}` : '';
  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    try {
      const destination = new URL(next || '/checkout', window.location.origin);
      if (
        destination.origin === window.location.origin &&
        (destination.pathname === '/checkout' ||
          (!isDomainIdentifier(slug) &&
            destination.pathname === `/${slug}/checkout`))
      ) {
        setInvalidDestination(false);
        router.replace(asRoute(`${destination.pathname}${destination.search}`));
      } else {
        setInvalidDestination(true);
      }
    } catch {
      setInvalidDestination(true);
    }
  }, [isLoading, isAuthenticated, next, slug, router]);
  return (
    <main className="mx-auto max-w-md p-8 text-center" role="status">
      {isLoading ? (
        'Preparing your checkout…'
      ) : isAuthenticated && !invalidDestination ? (
        'Returning to checkout…'
      ) : invalidDestination ? (
        <p>
          We couldn’t open that checkout.{' '}
          <a className="underline" href={asRoute(`${basePath}/checkout`)}>
            Return to checkout
          </a>
        </p>
      ) : (
        <p>
          We could not restore your checkout.{' '}
          <a className="underline" href={asRoute(`${basePath}/account/login`)}>
            Sign in again
          </a>
        </p>
      )}
    </main>
  );
}
