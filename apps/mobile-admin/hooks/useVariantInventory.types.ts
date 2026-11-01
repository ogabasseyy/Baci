export type VariantInventoryStatus =
  | 'available'
  | 'reserved'
  | 'sold'
  | 'returned'
  | 'defective';

export type VariantInventorySource =
  | 'merchant_stock'
  | 'vendor_sourced'
  | 'dropship';

export type InventoryTrackingPolicy =
  | 'off'
  | 'serialized_strict'
  | 'serialized_then_unlimited'
  | 'inherit';

export interface VariantInventoryUnit {
  id: string;
  merchant_id: string;
  product_id: string;
  variant_id: string | null;
  identifier_type: 'imei' | 'serial';
  identifier_value: string;
  status: VariantInventoryStatus;
  source: VariantInventorySource;
  notes: string | null;
  branch_id: string | null;
  condition_offer_id?: string | null;
  is_inventory_anchor?: boolean;
  created_at: string;
  updated_at: string;
}

export interface VariantInventoryCursor {
  created_at: string;
  id: string;
}

export interface VariantInventoryPage {
  units: VariantInventoryUnit[];
  nextCursor: VariantInventoryCursor | null;
  hasMore: boolean;
}

type RestockUnitInputBase = {
  source?: VariantInventorySource;
  notes?: string;
};

type LegacyImeiRestockUnitInput = RestockUnitInputBase & {
  imei: string;
  serial?: never;
  identifier_value?: never;
  identifier_type?: never;
};

type LegacySerialRestockUnitInput = RestockUnitInputBase & {
  serial: string;
  imei?: never;
  identifier_value?: never;
  identifier_type?: never;
};

type CanonicalRestockUnitInput = RestockUnitInputBase & {
  identifier_value: string;
  identifier_type: 'imei' | 'serial';
  imei?: never;
  serial?: never;
};

export type RestockUnitInput =
  | LegacyImeiRestockUnitInput
  | LegacySerialRestockUnitInput
  | CanonicalRestockUnitInput;

export interface VariantInventoryFilters {
  productId: string;
  variantId?: string | null;
  status?: VariantInventoryStatus | null;
  branchScope?: string;
  branchId?: string | null;
  limit?: number;
}

export interface RestockVariantInventoryResult {
  success: boolean;
  productId: string;
  variantId: string;
  restockedCount: number;
  unitIds: string[];
}

export interface RestockVariantInventoryVariables {
  productId: string;
  units: RestockUnitInput[];
  variantId?: string | null;
  inventoryTrackingPolicy?: InventoryTrackingPolicy | null;
  branchId?: string | null;
}

export interface UpdateVariantInventoryUnitVariables {
  unitId: string;
  productId: string;
  identifierValue?: string | null;
  status?: VariantInventoryStatus | null;
  branchId?: string | null;
  setBranch?: boolean;
  notes?: string | null;
}

export interface DeleteVariantInventoryUnitResult {
  deleted: boolean;
  productId: string;
  variantId: string | null;
  branchId: string | null;
  stockSynced: boolean;
}

export interface DeleteVariantInventoryUnitVariables {
  unitId: string;
  productId: string;
}

export interface UpdateInventoryTrackingPolicyVariables {
  productId: string;
  inventoryTrackingPolicy: InventoryTrackingPolicy;
  variantId?: string | null;
}
