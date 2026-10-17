'use client';

import { type ComponentType, lazy, Suspense } from 'react';
import type { TemplatePageProps } from './template-page-props';

function createDeferredTemplateHome(
  loadHome: () => Promise<ComponentType<TemplatePageProps>>
): ComponentType<TemplatePageProps> {
  const LazyHome = lazy(async () => ({
    default: await loadHome(),
  }));

  function DeferredTemplateHome(props: TemplatePageProps) {
    return (
      <Suspense fallback={null}>
        <LazyHome {...props} />
      </Suspense>
    );
  }

  return DeferredTemplateHome;
}

export const ElectronicsTemplateHome = createDeferredTemplateHome(async () => {
  const { GadgetDefaultTemplate } = await import(
    '@/components/storefront/templates/gadget-default-template'
  );
  return GadgetDefaultTemplate as ComponentType<TemplatePageProps>;
});

export const FashionTemplateHome = createDeferredTemplateHome(async () => {
  const { PremiumDefaultTemplate } = await import(
    '@/components/storefront/templates/premium-default'
  );
  return PremiumDefaultTemplate as ComponentType<TemplatePageProps>;
});

export const HomeGoodsTemplateHome = createDeferredTemplateHome(async () => {
  const { HomeGoodsHome } = await import('./home-goods');
  return HomeGoodsHome;
});

export const FoodBeverageTemplateHome = createDeferredTemplateHome(async () => {
  const { FoodBeverageHome } = await import('./food-beverage');
  return FoodBeverageHome;
});

export const HealthBeautyTemplateHome = createDeferredTemplateHome(async () => {
  const { BeautyHome } = await import('./beauty');
  return BeautyHome;
});

export const HairExtensionsTemplateHome = createDeferredTemplateHome(
  async () => {
    const { HairExtensionsHome } = await import('./hair-extensions');
    return HairExtensionsHome;
  }
);

export const PharmaceuticalsTemplateHome = createDeferredTemplateHome(
  async () => {
    const { PharmaceuticalHome } = await import('./pharmaceutical');
    return PharmaceuticalHome;
  }
);

export const GadgetUniverseTemplateHome = createDeferredTemplateHome(
  async () => {
    const { GadgetUniverseTemplate } = await import(
      '@/components/storefront/templates/gadget-universe'
    );
    return GadgetUniverseTemplate as unknown as ComponentType<TemplatePageProps>;
  }
);

export const GadgetsProTemplateHome = createDeferredTemplateHome(async () => {
  const { Home } = await import('@/components/storefront/new-template/home');
  return Home as ComponentType<TemplatePageProps>;
});

export const HandmadeTemplateHome = createDeferredTemplateHome(async () => {
  const { HandmadeHome } = await import('./artisan');
  return HandmadeHome;
});
