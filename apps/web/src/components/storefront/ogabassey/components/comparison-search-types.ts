import type { Category, Product, ProductSpecSection } from '../types';

export interface SearchResultProduct {
  id: string | number;
  name: string;
  slug?: string;
  price: number;
  image?: string;
  imageLarge?: string;
  description?: string;
  rating?: number;
  category?: string;
  category_slug?: string | null;
  categories?: Category;
  condition?: string;
  brand?: string;
  product_key_specs?: Product['product_key_specs'];
  specifications?: ProductSpecSection[];
  variant_attributes?: Product['variant_attributes'];
}
