import type React from 'react';
import { OgabasseyStorefrontLayout } from '@/components/storefront/ogabassey/storefront-layout';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import type { MerchantData } from '@/hooks/merchant/types';

/**
 * Renders the appropriate layout wrapper based on the merchant's template.
 * Currently supports 'ogabassey' template with persistent layout.
 */
export function StorefrontLayoutRenderer({
  merchant,
  preloadHeroLcpImages,
  routingMode,
  children,
}: {
  merchant: MerchantData;
  preloadHeroLcpImages: boolean;
  routingMode: 'domain' | 'path';
  children: React.ReactNode;
}) {
  // Theme is handled client-side by V2ThemeProvider (reads cookie on mount).
  // Trade-off: removing server-side theme detection (cookies()) enables PPR static shells
  // but may cause a single-frame flash when seasonal themes (e.g., santa in December)
  // differ from the 'standard' default. SnowEffect uses fixed inset-0 pointer-events-none,
  // so there is zero CLS impact. The flash is imperceptible in practice.
  // hideNavigation resolves inside `OgabasseyLayoutChrome` (a client
  // component) via `usePathname()`, so route-based hide state stays
  // reactive across client-side routing. The `hideNavigation` prop on
  // this layout is kept as an override-only escape hatch.
  const templateId = merchant.template_id;

  if (templateId === OGABASSEY_TEMPLATE_ID) {
    return (
      <OgabasseyStorefrontLayout
        merchant={merchant}
        preloadHeroLcpImages={preloadHeroLcpImages}
        routingMode={routingMode}
      >
        {children}
      </OgabasseyStorefrontLayout>
    );
  }

  // Default / other templates: No global layout wrapper (layout handled per page)
  return <>{children}</>;
}
