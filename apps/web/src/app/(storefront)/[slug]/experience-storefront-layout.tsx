import { type ReactNode, Suspense } from 'react';
import { ExperienceShell } from '@/components/storefront/experience/ExperienceShell';
import { ExperienceUnavailable } from '@/components/storefront/experience/ExperienceUnavailable';
import { ExperienceLayoutSwitch } from '@/components/storefront/experience/experience-layout-switch';
import type { MerchantData } from '@/hooks/merchant/types';
import { loadPublishedExperience } from '@/lib/experience/published-manifest';
import { StorefrontLayoutRenderer } from './storefront-layout-renderer';
export async function ResolvedExperienceStorefrontLayout({
  merchant,
  children,
  preloadHeroLcpImages,
  routingMode,
}: {
  merchant: MerchantData;
  children: ReactNode;
  preloadHeroLcpImages: boolean;
  routingMode: 'domain' | 'path';
}) {
  let experience: Awaited<ReturnType<typeof loadPublishedExperience>>;
  try {
    experience = await loadPublishedExperience(merchant);
  } catch {
    return (
      <ExperienceUnavailable
        checkoutPath={
          routingMode === 'domain' ? '/checkout' : `/${merchant.slug}/checkout`
        }
        checkoutFallback={
          <StorefrontLayoutRenderer
            merchant={merchant}
            preloadHeroLcpImages={preloadHeroLcpImages}
            routingMode={routingMode}
          >
            {children}
          </StorefrontLayoutRenderer>
        }
      />
    );
  }
  if (!experience)
    return (
      <StorefrontLayoutRenderer
        merchant={merchant}
        preloadHeroLcpImages={preloadHeroLcpImages}
        routingMode={routingMode}
      >
        {children}
      </StorefrontLayoutRenderer>
    );
  return (
    <ExperienceShell merchantSlug={merchant.slug ?? ''}>
      <ExperienceLayoutSwitch
        routes={experience.routes}
        basePath={routingMode === 'domain' ? '' : `/${merchant.slug}`}
        nativeLayout={
          <StorefrontLayoutRenderer
            merchant={merchant}
            preloadHeroLcpImages={preloadHeroLcpImages}
            routingMode={routingMode}
          >
            {children}
          </StorefrontLayoutRenderer>
        }
      >
        {children}
      </ExperienceLayoutSwitch>
    </ExperienceShell>
  );
}

export function ExperienceStorefrontLayout(
  props: Parameters<typeof ResolvedExperienceStorefrontLayout>[0]
) {
  return (
    <Suspense fallback={<main role="status">Loading storefront…</main>}>
      <ResolvedExperienceStorefrontLayout {...props} />
    </Suspense>
  );
}
