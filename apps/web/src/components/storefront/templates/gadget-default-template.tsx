'use client';

import type { CSSProperties } from 'react';
import { AnnouncementBar } from '@/components/storefront/blocks/announcement-bar';
import { Footer } from '@/components/storefront/blocks/footer';
import { Header } from '@/components/storefront/blocks/header';
import { Newsletter } from '@/components/storefront/blocks/newsletter';
import { StorefrontProductGrid } from '@/components/storefront/product-grid';
import { GadgetDefaultBrowseRail } from '@/components/storefront/templates/gadget-default-browse-rail';
import { GadgetDefaultHero } from '@/components/storefront/templates/gadget-default-hero';
import { useIndustryTheme } from '@/hooks/use-industry-theme';
import { useMerchant } from '@/hooks/use-merchant-client';
import type { TemplatePageProps } from '@/templates/registry';

const RADIUS_MAP = {
  none: 'rounded-none',
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
  '2xl': 'rounded-2xl',
  '3xl': 'rounded-3xl',
  full: 'rounded-full',
};

export function GadgetDefaultTemplate({
  isPreview,
  products = [],
}: TemplatePageProps) {
  const { merchant, basePath } = useMerchant();
  const theme = useIndustryTheme(merchant?.business_type);

  const radiusClass =
    RADIUS_MAP[theme.radius as keyof typeof RADIUS_MAP] || 'rounded-md';

  return (
    <div
      className="min-h-screen font-sans transition-colors duration-300"
      style={
        {
          backgroundColor: theme.colors.background,
          color: theme.colors.text,
          '--store-primary': theme.colors.primary,
          '--store-primary-text': '#FFFFFF',
          '--store-background': theme.colors.background,
          '--store-background-text': theme.colors.text,
          '--store-accent': theme.colors.accent,
          '--store-accent-text': '#FFFFFF',
        } as CSSProperties
      }
    >
      <AnnouncementBar />
      <Header
        showLogo={true}
        showSearch={true}
        showCart={true}
        showMenu={true}
        layout="logo-left-nav-center"
        sticky={true}
        isPreview={isPreview}
      />

      <main>
        <GadgetDefaultHero
          businessName={merchant?.business_name}
          businessType={merchant?.business_type}
          basePath={basePath}
          theme={theme}
          radiusClass={radiusClass}
        />

        <GadgetDefaultBrowseRail
          products={products}
          basePath={basePath}
          theme={theme}
          radiusClass={radiusClass}
        />

        <section className="py-12 container mx-auto px-4">
          <StorefrontProductGrid
            title="Featured Products"
            columns={4}
            limit={4}
          />
        </section>

        <Newsletter
          title="Stay Updated"
          subtitle="Join our mailing list for exclusive offers."
          buttonText="Subscribe"
          backgroundColor={theme.colors.card}
        />
      </main>

      <Footer
        backgroundColor={theme.colors.primary}
        textColor="#ffffff"
        showNewsletter={false}
      />
    </div>
  );
}
