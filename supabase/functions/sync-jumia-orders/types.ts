import type { JumiaOrderSyncIntegration } from './load-jumia-order-sync-integrations.ts';

export type MarketplaceIntegration = JumiaOrderSyncIntegration;

export interface JumiaOrder {
  id: string;
  number: number;
  status: string;
  createdAt: string;
  shippingAddress: {
    firstName: string;
    lastName: string;
    address: string;
    city: string;
    postalCode: string;
    ward: string;
    region: string;
    countryName: string;
  } | null;
  totalAmount: {
    currency: string;
    value: number;
  };
}

export interface ProductMapping {
  id: string;
  product_id: string;
  variant_id: string | null;
  jumia_seller_sku: string | null;
  jumia_product_id: string | null;
  baci_stock_at_last_sync: number | null;
}
