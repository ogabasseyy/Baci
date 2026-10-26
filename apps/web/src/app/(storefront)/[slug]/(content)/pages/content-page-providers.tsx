'use client';

import type { ReactNode } from 'react';
import AppBody, { type AppBodyMerchant } from '@/components/app-body';
import { StorefrontProvider } from '@/contexts/storefront-context';
import { MerchantProvider } from '@/hooks/merchant/merchant-provider';

/** Shared legacy content composition; the persistent storefront shell owns consent. */
export function ContentPageProviders({
  merchant,
  children,
}: {
  merchant: { slug: string } & AppBodyMerchant;
  children: ReactNode;
}) {
  return (
    <MerchantProvider slug={merchant.slug}>
      <StorefrontProvider>
        <AppBody merchant={merchant} showCookieConsent={false}>
          {children}
        </AppBody>
      </StorefrontProvider>
    </MerchantProvider>
  );
}
