import type { ComponentType } from 'react';
import type { TemplatePageProps } from './template-page-props';

export async function loadElectronicsTemplateHome(): Promise<
  ComponentType<TemplatePageProps>
> {
  const { GadgetDefaultTemplate } = await import(
    '@/components/storefront/templates/gadget-default-template'
  );
  return GadgetDefaultTemplate as ComponentType<TemplatePageProps>;
}

export async function loadFashionTemplateHome(): Promise<
  ComponentType<TemplatePageProps>
> {
  const { PremiumDefaultTemplate } = await import(
    '@/components/storefront/templates/premium-default'
  );
  return PremiumDefaultTemplate as ComponentType<TemplatePageProps>;
}

export async function loadHomeGoodsTemplateHome(): Promise<
  ComponentType<TemplatePageProps>
> {
  const { HomeGoodsHome } = await import('./home-goods');
  return HomeGoodsHome;
}

export async function loadFoodBeverageTemplateHome(): Promise<
  ComponentType<TemplatePageProps>
> {
  const { FoodBeverageHome } = await import('./food-beverage');
  return FoodBeverageHome;
}

export async function loadHealthBeautyTemplateHome(): Promise<
  ComponentType<TemplatePageProps>
> {
  const { BeautyHome } = await import('./beauty');
  return BeautyHome;
}

export async function loadHairExtensionsTemplateHome(): Promise<
  ComponentType<TemplatePageProps>
> {
  const { HairExtensionsHome } = await import('./hair-extensions');
  return HairExtensionsHome;
}

export async function loadPharmaceuticalsTemplateHome(): Promise<
  ComponentType<TemplatePageProps>
> {
  const { PharmaceuticalHome } = await import('./pharmaceutical');
  return PharmaceuticalHome;
}

export async function loadGadgetUniverseTemplateHome(): Promise<
  ComponentType<TemplatePageProps>
> {
  const { GadgetUniverseTemplate } = await import(
    '@/components/storefront/templates/gadget-universe'
  );
  return GadgetUniverseTemplate as unknown as ComponentType<TemplatePageProps>;
}

export async function loadGadgetsProTemplateHome(): Promise<
  ComponentType<TemplatePageProps>
> {
  const { Home } = await import('@/components/storefront/new-template/home');
  return Home as ComponentType<TemplatePageProps>;
}

export async function loadHandmadeTemplateHome(): Promise<
  ComponentType<TemplatePageProps>
> {
  const { HandmadeHome } = await import('./artisan');
  return HandmadeHome;
}
