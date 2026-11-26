'use client';

import { useSyncExternalStore } from 'react';
import { defaultStaffAccess } from './constants';
import { MerchantContext } from './merchant-context';
import type { MerchantProviderProps, RoutingMode } from './types';

const ROOT_DOMAIN = (
  process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'usebaci.com'
).toLowerCase();

const subscribeRoutingMode = () => () => {
  // Hostname and routing mode are static for the page lifetime.
};

function isClientPlatformHost(hostname: string): boolean {
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === ROOT_DOMAIN ||
    hostname === `www.${ROOT_DOMAIN}` ||
    hostname === 'usebaci.com' ||
    hostname === 'www.usebaci.com'
  ) {
    return true;
  }

  if (
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  ) {
    return true;
  }

  if (hostname.endsWith('.vercel.app')) {
    const label = hostname.slice(0, -'.vercel.app'.length);
    return label.length > 0 && !label.includes('.');
  }

  return false;
}

function detectClientRoutingMode(
  merchantSlug: string,
  serverRoutingMode: RoutingMode
): RoutingMode {
  if (serverRoutingMode === 'domain' || typeof window === 'undefined') {
    return serverRoutingMode;
  }

  const hostname = window.location.hostname.toLowerCase();
  if (isClientPlatformHost(hostname)) {
    return serverRoutingMode;
  }

  const normalizedSlug = merchantSlug.toLowerCase();
  if (normalizedSlug && hostname === `${normalizedSlug}.${ROOT_DOMAIN}`) {
    return 'domain';
  }

  return serverRoutingMode;
}

export function StorefrontMerchantProvider({
  children,
  slug,
  initialMerchant = null,
  initialRoutingMode,
  loading = false,
  navigationCategories = [],
  shellSnapshot = null,
}: MerchantProviderProps) {
  const merchant = shellSnapshot?.merchant ?? initialMerchant;
  const serverRoutingMode =
    shellSnapshot?.routingMode ?? initialRoutingMode ?? 'path';
  const resolvedSlug = merchant?.slug ?? slug ?? '';
  const routingMode = useSyncExternalStore(
    subscribeRoutingMode,
    () => detectClientRoutingMode(resolvedSlug, serverRoutingMode),
    () => serverRoutingMode
  );
  const basePath =
    routingMode === 'domain'
      ? ''
      : (shellSnapshot?.basePath ?? `/${resolvedSlug}`);
  const resolvedNavigationCategories =
    shellSnapshot?.navigationCategories ?? navigationCategories;

  return (
    <MerchantContext.Provider
      value={{
        merchant,
        loading,
        updateMerchant: () => {
          throw new Error(
            'Merchant updates are unavailable in storefront context.'
          );
        },
        reloadMerchant: () => undefined,
        staffAccess: defaultStaffAccess,
        hasPermission: () => false,
        routingMode,
        basePath,
        navigationCategories: resolvedNavigationCategories,
      }}
    >
      {children}
    </MerchantContext.Provider>
  );
}
