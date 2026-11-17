'use client'; // Needs the router and a click handler.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { MouseEvent, ReactNode } from 'react';
import { stashPrivateParamsForNavigation } from '@/lib/privacy/private-url-param-handoff';
import { asRoute } from '@/lib/routes';

function isPlainPrimaryClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

/**
 * "Track My Order" link. The href keeps the token so open-in-new-tab and
 * middle-click still work (the destination scrubs it on arrival). A plain
 * click navigates in-app to the cleaned href instead, with the token handed
 * over off the URL, so it never reaches the address bar of this tab.
 */
export function OrderSuccessTrackLink({
  href,
  slug,
  className,
  children,
}: {
  href: string;
  slug: string | null | undefined;
  className: string;
  children: ReactNode;
}) {
  const router = useRouter();

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || !isPlainPrimaryClick(event)) return;
    const cleaned = stashPrivateParamsForNavigation(href, slug);
    // Nothing was handed over (storage unavailable): let the link navigate.
    if (cleaned === href) return;
    event.preventDefault();
    router.push(asRoute(cleaned));
  };

  return (
    <Link href={asRoute(href)} className={className} onClick={handleClick}>
      {children}
    </Link>
  );
}
