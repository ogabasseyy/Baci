import type { Product } from '@/types/product';

export interface Category {
  id: string;
  name: string;
  slug: string;
  image_url?: string;
  icon?: string;
}

export interface UseProductsOptions {
  refinements?: import('@baci/shared/lib').SearchRefinements;
  category?: string;
  limit?: number;
  sortBy?: 'price_asc' | 'price_desc' | 'newest' | 'popular';
  search?: string;
  condition?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  enabled?: boolean;
}

export interface ProductsPage {
  products: Product[];
  nextOffset: number | null;
  total: number;
}
