import type { JumiaAttributeSetResponse } from '@/schemas/jumia/catalog';
import type { JumiaCreateProduct } from '@/schemas/jumia/create-product';
import type { JumiaDraftValue } from './attribute-values';

export type CanonicalProduct = {
  id: string;
  merchantId: string;
  status: string;
  hasVariants: boolean | null;
  variantModel: string | null;
  updatedAt: string;
  name: string | null;
  description: string | null;
  sku: string | null;
  exportImages: unknown;
  price: number | null;
  stock: number | null;
  stockQuantity: number | null;
  manageStock: boolean | null;
  inventoryTrackingPolicy: string | null;
  inventoryAnchorVariantId: string | null;
  condition: string | null;
  weightValue: number | null;
  weightUnit: string | null;
  categoryId: string | null;
};

export type CanonicalVariant = {
  id: string;
  attributes: Record<string, unknown>;
  sku: string | null;
  priceOverride: number | null;
  stockQuantity: number | null;
  inventoryTrackingPolicy: string | null;
  condition: string | null;
  updatedAt: string;
  isInventoryAnchor: boolean;
};

export type CanonicalImage = {
  id: string;
  variantId: string | null;
  status: string;
  verifiedUrl: string | null;
  verifiedFormat: string | null;
  isPrimary: boolean;
  position: number;
  verifiedAt: string | null;
  updatedAt: string;
};

export type JumiaCanonicalPreflightInput = {
  merchantId: string;
  selectionId: string;
  sourceCategoryId: string;
  sourceVersion: string;
  source: {
    contractVersion: 1;
    product: CanonicalProduct;
    categoryMemberships: { id: string; name: string; isActive: boolean }[];
    variants: CanonicalVariant[];
    images: CanonicalImage[];
  };
  destination: {
    shopId: string;
    businessClientCode: string;
    countryCode: string;
    localCurrency: string;
  };
  mapping: {
    category: {
      code: number;
      name: string;
      attributeSetId: string;
      activeLeaf: boolean;
      availableForDestination: boolean;
    };
    brand: { code: number; name: string; availableForDestination: boolean };
    attributes: JumiaAttributeSetResponse['attributes'];
    values: Record<string, JumiaDraftValue | undefined>;
    categoryConfirmed: boolean;
    bullets: string[];
    variation?: { sourceAttributeName: string };
  };
  evidence: {
    providerClassification: '3c' | 'non-3c' | 'unknown';
    globalPrice: { currency: string; value: number } | null;
    images: Record<
      string,
      {
        publiclyReachable: boolean;
        byteSize: number | null;
        width: number | null;
        height: number | null;
        qualityAccepted: boolean;
      }
    >;
  };
};

export type JumiaCanonicalPreflightError = {
  productId: string;
  variantId?: string;
  field: string;
  code: string;
};

export type JumiaCanonicalPreflightResult =
  | { success: false; products: []; errors: JumiaCanonicalPreflightError[] }
  | {
      success: true;
      products: JumiaCreateProduct[];
      families: {
        familyKey: string;
        businessClientCode: string;
        categoryCode: number;
        attributeSetId: string;
        records: JumiaCreateProduct[];
      }[];
      evidenceBoundaries: string[];
    };
