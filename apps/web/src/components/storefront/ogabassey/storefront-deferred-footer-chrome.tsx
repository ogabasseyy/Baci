'use client';

import type { MerchantData } from '@/hooks/merchant/types';
import { AdUnit } from './components/AdUnit';
import { DeferredChatWidget } from './components/chat/DeferredChatWidget';
import { DeferredCartSidebar } from './components/deferred-cart-sidebar';
import { Footer } from './components/Footer';

interface StorefrontDeferredFooterChromeProps {
  basePath: string;
  merchant?: MerchantData;
}

export function StorefrontDeferredFooterChrome({
  basePath,
  merchant,
}: StorefrontDeferredFooterChromeProps) {
  return (
    <>
      {/* Placed above `<Footer />` so shoppers reaching the end of page content
          actually view the unit (lifting Active View % out of Smart Pricing
          discounts). Reserves the complete wrapper (~200px mobile / ~350px
          desktop) so `content-visibility: auto` never shifts layout. */}
      <div className="flex min-h-[200px] justify-center border-store-border border-t bg-store-background py-4 content-auto md:min-h-[350px] [contain-intrinsic-size:1400px_200px] md:[contain-intrinsic-size:1400px_350px]">
        <AdUnit placementKey="FOOTER_BANNER" />
      </div>

      <Footer merchant={merchant} storeSlug={basePath} />

      <DeferredCartSidebar />
      <DeferredChatWidget />
    </>
  );
}
