import type {
  InformationalGuideLink,
  PublishedClusterPost,
} from '@/lib/storefront-content/content-cluster-types';

export type CategoryHubSource = 'merchant' | 'curated' | 'fallback';

export interface BrandAuthorityEntry {
  brandAliases?: string[];
  brandKey: string;
  brandQueryValue: string;
  brandSlug?: string;
  categorySlug: string;
  displayName: string;
  intro?: string;
  minimumProducts: number;
}

export interface ModelFamilyAuthorityEntry {
  brandKey: string;
  categorySlug: string;
  displayName: string;
  familyKey: string;
  minimumProducts: number;
  productNamePattern: RegExp;
}

export interface CategoryHubFaqItem {
  question: string;
  answer: string;
}

export interface CategoryHubCard {
  title: string;
  description: string;
  href: string;
  eyebrow?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}

export interface CategoryHubIntro {
  heading: string;
  description: string;
  source: CategoryHubSource;
}

export interface CategoryHubModel {
  intro: CategoryHubIntro;
  trustFeatures: string[];
  bestForCards: CategoryHubCard[];
  brandCards: CategoryHubCard[];
  priceBandCards: CategoryHubCard[];
  comparisonLinks: CategoryHubComparisonLink[];
  guideLinks: InformationalGuideLink[];
  faqItems: CategoryHubFaqItem[];
}

export interface CategoryHubComparisonLink {
  href: string;
  label: string;
}

export interface CategoryHubProduct {
  id?: string | null;
  slug: string;
  name: string;
  price: number;
  stock?: number | string | null;
  stock_quantity?: number | string | null;
  manage_stock?: boolean | null;
  has_condition_offers?: boolean | null;
  brand?: string | null;
  condition?: string | null;
  category_slug?: string | null;
  product_key_specs?: Record<string, unknown> | null;
}

export interface CategoryHubSeoInput {
  heading?: string | null;
  description?: string | null;
  features?: string[] | null;
  faqs?: CategoryHubFaqItem[] | null;
}

export interface CategoryHubBestForCopy {
  title: string;
  description: string;
}

export interface CategoryHubPriceBandCopy {
  slug: string;
  title: string;
  description: string;
}

export interface CategoryHubDefaults {
  intro: {
    heading: string;
    description: string;
  };
  trustFeatures: string[];
  faqItems: CategoryHubFaqItem[];
  bestFor: Record<string, CategoryHubBestForCopy>;
  brandHighlights: {
    heading: string;
    description: string;
  };
  priceBands: CategoryHubPriceBandCopy[];
}

export interface BuildCategoryHubModelInput {
  categorySlug: string;
  categoryName: string;
  merchantBusinessName: string;
  storeUrl: string;
  products: CategoryHubProduct[];
  priceBandProducts?: CategoryHubProduct[];
  compareProducts?: CategoryHubProduct[];
  merchantCurrency?: string | null;
  brandAuthorityEntries?: Array<
    BrandAuthorityEntry & {
      productCount: number;
      productCountIsLowerBound?: boolean;
    }
  >;
  comparisonLinks?: CategoryHubComparisonLink[];
  guidePosts?: PublishedClusterPost[];
  categorySeo?: CategoryHubSeoInput | null;
  collectionSeo?: CategoryHubSeoInput | null;
  isCollection?: boolean;
}
