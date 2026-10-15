'use client';

import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
} from 'react';
import type { CurrencyConfig } from '@/lib/currency';
import type { Product as CartProduct } from '@/lib/products';
import type { InitialCriticalVariantSelection } from './critical-commerce-selection';

export interface OgabasseyPdpCriticalCommerceProviderProps {
  cartProduct: CartProduct;
  children: ReactNode;
  currency?: CurrencyConfig;
  initialVariantSelection?: InitialCriticalVariantSelection;
  /**
   * Validated ?offer_id from the route (names one of cartProduct's
   * offers): prices the critical buy box from the exact advertised
   * offer and forwards it into the cart add.
   */
  initialOfferId?: string | null;
  /**
   * Exact-match missing flag for ?offer_id: purchase stays blocked
   * until the shopper picks a condition, mirroring the full PDP.
   */
  routeOfferMissing?: boolean;
  variantAxes?: string[];
  variantAxisOptions?: Record<string, string[]>;
  variantCount: number;
}

export interface OgabasseyPdpCriticalCommerceState {
  canAddToCart: boolean;
  currency: CurrencyConfig;
  explicitSelectedAxes: string[];
  handleAddToCart: () => void;
  handleAttributeSelection: (axis: string, value: string) => void;
  isAtMaxQuantity: boolean;
  maxQuantity: number | null;
  productForCart: CartProduct;
  quantity: number;
  renderableVariantAxes: string[];
  routeOfferMissingActive: boolean;
  selectedAttributes: Record<string, string>;
  setQuantity: Dispatch<SetStateAction<number>>;
  variantAxisOptions: Record<string, string[]>;
  variantCount: number;
  variants: CartProduct['variants'];
}

export const OgabasseyPdpCriticalCommerceContext =
  createContext<OgabasseyPdpCriticalCommerceState | null>(null);

export function useOgabasseyPdpCriticalCommerce() {
  const context = useContext(OgabasseyPdpCriticalCommerceContext);
  if (!context) {
    throw new Error(
      'Ogabassey PDP critical commerce components must be rendered inside OgabasseyPdpCriticalCommerceProvider.'
    );
  }

  return context;
}

export function useOptionalOgabasseyPdpCriticalCommerce() {
  return useContext(OgabasseyPdpCriticalCommerceContext);
}
