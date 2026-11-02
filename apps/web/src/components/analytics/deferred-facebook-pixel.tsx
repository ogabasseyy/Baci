'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { Suspense, useSyncExternalStore } from 'react';
import { validFacebookPixelId } from '@/lib/analytics/facebook-pixel-client';
import { subscribeSocialMarketingConsent } from '@/lib/analytics/subscribe-social-marketing-consent';
import { isAnalyticsAllowed } from '@/lib/analytics-consent';
import { usePreparedFacebookPixel } from './use-prepared-facebook-pixel';

const FacebookPixel = dynamic(() =>
  import('./facebook-pixel').then((module) => module.FacebookPixel)
);
const serverConsent = () => false;
export function DeferredFacebookPixel({
  merchantId,
  pixelId,
}: {
  merchantId: string;
  pixelId: string;
}) {
  const pathname = usePathname();
  const valid = validFacebookPixelId(pixelId);
  const allowed = useSyncExternalStore(
    subscribeSocialMarketingConsent,
    isAnalyticsAllowed,
    serverConsent
  );
  const epoch = usePreparedFacebookPixel(
    merchantId,
    valid ? pixelId : '',
    pathname
  );
  if (!merchantId || !valid || !allowed) return null;
  return (
    <Suspense fallback={null}>
      <FacebookPixel
        key={`${merchantId}:${pixelId}:${epoch}`}
        merchantId={merchantId}
        pixelId={pixelId}
      />
    </Suspense>
  );
}
