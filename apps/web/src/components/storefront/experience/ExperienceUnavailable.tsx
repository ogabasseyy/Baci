'use client';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
export function ExperienceUnavailable({
  checkoutFallback,
  checkoutPath,
}: {
  checkoutFallback?: ReactNode;
  checkoutPath?: string;
} = {}) {
  const router = useRouter();
  const pathname = usePathname();
  if (
    checkoutPath &&
    (pathname === checkoutPath || pathname?.startsWith(`${checkoutPath}/`))
  )
    return checkoutFallback;
  return (
    <main role="alert">
      <h1>Storefront temporarily unavailable</h1>
      <p>Refresh to load the current store.</p>
      <button type="button" onClick={() => router.refresh()}>
        Refresh storefront
      </button>
    </main>
  );
}
