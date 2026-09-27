// Types
export interface Product {
  id: string;
  name: string;
  slug: string | null;
  price: number;
  compare_at_price?: number;
  image_url?: string;
  image?: string;
  images?: string[];
  condition?: string;
  stock_level?: string;
  in_stock?: boolean | null;
  brand?: string;
  category?: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface WidgetState {
  cart: CartItem[];
  cartUrl?: string;
  [key: string]: unknown; // Index signature for type compatibility
}

export const createDefaultState = (): WidgetState => ({
  cart: [],
});
