'use client';

import { Loader2, Store } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { asRoute } from '@/lib/routes';
import { cn } from '@/lib/utils';

export const DashboardStoreLink = ({
  isMobile = false,
  isCollapsed,
  merchantLoading,
  storeUrl,
  customDomain,
}: {
  isMobile?: boolean;
  isCollapsed: boolean;
  merchantLoading: boolean;
  storeUrl: string;
  customDomain?: string;
}) => {
  const baseClassName = isMobile
    ? 'mx-[-0.65rem] flex items-center gap-4 rounded-xl px-3 py-2 text-muted-foreground'
    : cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground',
        isCollapsed && 'justify-center'
      );

  const isReady = !merchantLoading && storeUrl !== '#';

  if (!isReady) {
    const loadingContent = (
      <div className={cn(baseClassName, 'opacity-50 cursor-not-allowed')}>
        <Loader2
          className={cn(
            'size-4 motion-safe:animate-spin',
            isMobile && 'size-5'
          )}
        />
        {!isCollapsed && !isMobile && 'Visit Store'}
        {isMobile && 'Visit Store'}
      </div>
    );

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{loadingContent}</TooltipTrigger>
          <TooltipContent side="right">Loading store…</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const displayUrl = (() => {
    try {
      const url = new URL(storeUrl);
      return url.hostname;
    } catch {
      return 'Visit Store';
    }
  })();

  const linkContent = (
    <>
      <Store className={isMobile ? 'size-5' : 'size-4'} />
      {!isCollapsed && !isMobile && (
        <span className="font-medium text-foreground">{displayUrl}</span>
      )}
      {isMobile && (
        <span className="font-medium text-foreground">{displayUrl}</span>
      )}
    </>
  );

  // Validate that storeUrl is safe (relative or from trusted domain)
  // Only allow:
  // 1. Relative paths starting with /
  // 2. localhost URLs (development only)
  // 3. URLs ending with .usebaci.com (production)
  // 4. Custom domains that match merchant's custom_domain
  const isSafeUrl = (() => {
    if (storeUrl.startsWith('/') && !storeUrl.startsWith('//')) return true;
    if (storeUrl.startsWith('http://localhost:')) return true;

    try {
      const url = new URL(storeUrl);
      const trustedDomain =
        process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'usebaci.com';

      // Allow custom domains that match merchant's custom_domain
      if (customDomain && url.hostname === customDomain) {
        return true;
      }

      // Ensure the hostname ends with our trusted domain (prevents subdomain takeover)
      return (
        url.hostname.endsWith(`.${trustedDomain}`) ||
        url.hostname === trustedDomain
      );
    } catch {
      return false;
    }
  })();
  let safeHref: Route = asRoute('/');
  if (isSafeUrl) {
    safeHref = asRoute(storeUrl);
  }

  return (
    <Link
      href={safeHref}
      className={cn(baseClassName, 'transition-all hover:text-primary')}
    >
      {isCollapsed && !isMobile ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>{linkContent}</span>
            </TooltipTrigger>
            <TooltipContent side="right">Visit Store</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        linkContent
      )}
    </Link>
  );
};
