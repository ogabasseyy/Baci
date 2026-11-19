import type { CartItem } from '@/hooks/cart';

export interface NegotiationControllerOptions {
  cart?: CartItem[];
  condition?: string;
  currentPrice: number;
  isOpen: boolean;
  itemId?: string;
  merchantId: string;
  merchantSlug?: string;
  onSuccess: (finalPrice: number) => void;
  productBrand?: string;
  productName: string;
  productSlug?: string;
  type: 'single' | 'total';
  variantAttributes?: Record<string, string>;
  variantId?: string;
  variantName?: string;
}
