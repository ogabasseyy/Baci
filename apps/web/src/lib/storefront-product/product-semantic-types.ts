import type { CommercialSupportLink } from '@/lib/storefront-compare/build-commercial-support-links';
import type {
  InformationalGuideLink,
  PublishedClusterPost,
} from '@/lib/storefront-content/content-cluster-types';

export interface ProductSemanticCandidate {
  slug: string;
  name: string;
  price: number;
  brand?: string | null;
  condition?: string | null;
  stock?: number | null;
  category_slug?: string | null;
  product_key_specs?: Record<string, unknown> | null;
  is_parent?: boolean | null;
  parent_product_id?: string | null;
}

export interface ProductSemanticCard {
  title: string;
  description: string;
  href: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}

export interface ProductSemanticSection {
  heading: string;
  cards: ProductSemanticCard[];
}

export interface ProductSemanticModel {
  contextParagraphs?: string[];
  trustBullets: string[];
  supportLinks: CommercialSupportLink[];
  guideLinks: InformationalGuideLink[];
  alternatives: ProductSemanticSection | null;
  sameBrand: ProductSemanticSection | null;
  samePrice: ProductSemanticSection | null;
}

export interface BuildProductSemanticModelInput {
  storeUrl: string;
  merchantBusinessName: string;
  categorySlug: string;
  categoryName: string;
  currentProduct: ProductSemanticCandidate;
  inventory: ProductSemanticCandidate[];
  guidePosts?: PublishedClusterPost[];
  priorityGuidePostSlugs?: string[];
  countryCode?: string | null;
}
