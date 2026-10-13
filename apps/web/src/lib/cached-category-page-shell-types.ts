import type { CachedCategoryPageProductScope } from '@/lib/category-page-product-id-cache';

export interface CachedCategoryFaqItem {
  answer: string;
  question: string;
}

export interface CachedCategoryRecord {
  description: string | null;
  id: string;
  image_url: string | null;
  is_active: boolean;
  name: string;
  parent:
    | { name: string; slug: string }
    | Array<{ name: string; slug: string }>
    | null;
  parent_id?: string | null;
  seo_description: string | null;
  seo_faq: CachedCategoryFaqItem[] | null;
  seo_features: string[] | null;
  seo_heading: string | null;
  slug: string;
}

export interface CachedCategorySeo {
  description: string;
  faqs: CachedCategoryFaqItem[];
  features: string[];
  heading: string;
}

export type CachedCategoryPageShellData =
  | {
      description: string;
      fallbackDescription?: string;
      fallbackName?: string;
      isCollection: true;
      isInactiveCategory?: false;
      name: string;
      productScope: CachedCategoryPageProductScope;
      seo: CachedCategorySeo;
    }
  | {
      category: CachedCategoryRecord | null;
      categoryQueryFailed?: boolean;
      fallbackDescription: string;
      fallbackName: string;
      isCollection: false;
      isInactiveCategory: boolean;
      name?: string;
      productScope: CachedCategoryPageProductScope;
      seo?: null;
    };
