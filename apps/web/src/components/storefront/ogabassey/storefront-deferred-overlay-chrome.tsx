'use client';

import { usePathname } from 'next/navigation';
import { shouldHideOgabasseyNavigation } from './storefront-layout-utils';
import { OfflineNotice } from './components/OfflineNotice';
import { PopupSystem } from './components/PopupSystem';

export function StorefrontDeferredOverlayChrome() {
  const hidePromotions = shouldHideOgabasseyNavigation(usePathname());
  return (
    <>
      {!hidePromotions && <PopupSystem />}
      <OfflineNotice />
    </>
  );
}
