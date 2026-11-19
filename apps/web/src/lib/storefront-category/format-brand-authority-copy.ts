import { generateSlug } from '@/lib/seo-utils';
import { getCategoryAuthorityNoun } from './get-category-authority-noun';

export interface FormatBrandAuthorityCopyInput {
  categorySlug: string;
  categoryName?: string;
  brandKey: string;
  brandDisplayName: string;
  merchantBusinessName: string;
  productCount: number;
  countrySuffix?: string;
  customIntro?: string | null;
}

export interface BrandAuthorityCopyResult {
  heading: string;
  metaDescription: string;
  intro: string;
  familyNoun: string;
  formatFamilyLinkLabel: (familyDisplayName: string) => string;
}

interface CategoryCopyProfile {
  titleNoun: string;
  productPhrase: (brandName: string) => string;
  familyNoun: string;
}

const CATEGORY_PROFILES: Record<string, CategoryCopyProfile> = {
  smartphones: {
    titleNoun: 'Phones',
    productPhrase: (brand) => `${brand} phones`,
    familyNoun: 'phones',
  },
  laptops: {
    titleNoun: 'Laptops',
    productPhrase: (brand) => `${brand} laptops`,
    familyNoun: 'laptops',
  },
  'gaming-laptops': {
    titleNoun: 'Gaming Laptops',
    productPhrase: (brand) => `${brand} gaming laptops`,
    familyNoun: 'gaming laptops',
  },
  tablets: {
    titleNoun: 'Tablets',
    productPhrase: (brand) => `${brand} tablets`,
    familyNoun: 'tablets',
  },
  audio: {
    titleNoun: 'Audio & Speakers',
    productPhrase: (brand) => `${brand} audio products`,
    familyNoun: 'audio products',
  },
  smartwatches: {
    titleNoun: 'Smartwatches',
    productPhrase: (brand) => `${brand} smartwatches`,
    familyNoun: 'smartwatches',
  },
};

/**
 * Formats category-aware headings, meta descriptions, intro copy, and family
 * link labels for brand authority hub pages.
 */
export function formatBrandAuthorityCopy(
  input: FormatBrandAuthorityCopyInput
): BrandAuthorityCopyResult {
  const normalizedCategorySlug = generateSlug(input.categorySlug);
  const normalizedBrandKey = generateSlug(input.brandKey);
  const countrySuffix = input.countrySuffix ?? '';

  if (normalizedCategorySlug === 'playstation-5') {
    if (normalizedBrandKey === 'playstation') {
      const heading = `PlayStation 5 Games, Consoles and Prices${countrySuffix}`;
      const metaDescription = `Compare a selection of ${input.productCount} PlayStation 5 products from ${input.merchantBusinessName}, with current prices, key specs, condition, and availability${countrySuffix}.`;
      const intro = input.customIntro
        ? input.customIntro.replaceAll(
            '{merchantName}',
            input.merchantBusinessName
          )
        : `Explore a selection of ${input.productCount} PlayStation 5 products from ${input.merchantBusinessName}. Compare current prices, specifications, condition, and availability before choosing a model.`;
      const familyNoun = 'products';
      return {
        heading,
        metaDescription,
        intro,
        familyNoun,
        formatFamilyLinkLabel: (familyDisplayName) =>
          `${familyDisplayName} ${familyNoun}`,
      };
    }

    const heading = `${input.brandDisplayName} Products for PlayStation 5 and Prices${countrySuffix}`;
    const metaDescription = `Compare a selection of ${input.productCount} ${input.brandDisplayName} products for PlayStation 5 from ${input.merchantBusinessName}, with current prices, key specs, condition, and availability${countrySuffix}.`;
    const intro = input.customIntro
      ? input.customIntro.replaceAll(
          '{merchantName}',
          input.merchantBusinessName
        )
      : `Explore a selection of ${input.productCount} ${input.brandDisplayName} products for PlayStation 5 from ${input.merchantBusinessName}. Compare current prices, specifications, condition, and availability before choosing a model.`;
    const familyNoun = 'products for PlayStation 5';
    return {
      heading,
      metaDescription,
      intro,
      familyNoun,
      formatFamilyLinkLabel: (familyDisplayName) =>
        `${familyDisplayName} ${familyNoun}`,
    };
  }

  const profile = CATEGORY_PROFILES[normalizedCategorySlug];
  if (profile) {
    const heading = `${input.brandDisplayName} ${profile.titleNoun} and Prices${countrySuffix}`;
    const productPhrase = profile.productPhrase(input.brandDisplayName);
    const metaDescription = `Compare a selection of ${input.productCount} ${productPhrase} from ${input.merchantBusinessName}, with current prices, key specs, condition, and availability${countrySuffix}.`;
    const intro = input.customIntro
      ? input.customIntro.replaceAll(
          '{merchantName}',
          input.merchantBusinessName
        )
      : `Explore a selection of ${input.productCount} ${productPhrase} from ${input.merchantBusinessName}. Compare current prices, specifications, condition, and availability before choosing a model.`;
    return {
      heading,
      metaDescription,
      intro,
      familyNoun: profile.familyNoun,
      formatFamilyLinkLabel: (familyDisplayName) =>
        `${familyDisplayName} ${profile.familyNoun}`,
    };
  }

  const fallbackNoun = getCategoryAuthorityNoun(
    input.categorySlug,
    input.categoryName
  );
  const heading = `${input.brandDisplayName} ${fallbackNoun.titleNoun} and Prices${countrySuffix}`;
  const productPhrase = `${input.brandDisplayName} ${fallbackNoun.lowerNoun}`;
  const metaDescription = `Compare a selection of ${input.productCount} ${productPhrase} from ${input.merchantBusinessName}, with current prices, key specs, condition, and availability${countrySuffix}.`;
  const intro = input.customIntro
    ? input.customIntro.replaceAll('{merchantName}', input.merchantBusinessName)
    : `Explore a selection of ${input.productCount} ${productPhrase} from ${input.merchantBusinessName}. Compare current prices, specifications, condition, and availability before choosing a model.`;
  return {
    heading,
    metaDescription,
    intro,
    familyNoun: fallbackNoun.lowerNoun,
    formatFamilyLinkLabel: (familyDisplayName) =>
      `${familyDisplayName} ${fallbackNoun.lowerNoun}`,
  };
}
