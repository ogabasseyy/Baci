export interface OrderItem {
  id: string;
  product_id: string;
  condition?: string | null;
  image_url?: string | null;
  variant_name?: string | null;
  product_name?: string;
  name?: string;
  quantity: number;
  price: number;
  product_images?: string[];
  gtin?: string | null;
  product_slug?: string;
  category?: string;
  category_slug?: string;
  categories?: { name?: string; slug?: string } | null;
  products?:
    | {
        slug?: string;
        gtin?: string | null;
        category?: string;
        category_slug?: string;
        categories?:
          | { name?: string; slug?: string }[]
          | { name?: string; slug?: string }
          | null;
      }
    | {
        slug?: string;
        gtin?: string | null;
        category?: string;
        category_slug?: string;
        categories?:
          | { name?: string; slug?: string }[]
          | { name?: string; slug?: string }
          | null;
      }[]
    | null;
}
