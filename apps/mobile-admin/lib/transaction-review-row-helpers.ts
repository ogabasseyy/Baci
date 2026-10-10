import type {
  TransactionReviewProductRow,
  TransactionReviewUnitCostRow,
  TransactionReviewVariantRow,
} from './transaction-review-types';

const SUPPLIER_METADATA_KEYS = [
  'supplier_name',
  'supplier',
  'vendor_name',
  'vendor',
] as const;

export const IMEI_KEYS = new Set(['imei', 'imei_number', 'imeiNumber']);
export const SERIAL_KEYS = new Set([
  'serial',
  'serial_number',
  'serialNumber',
  's/n',
]);

export interface FulfillmentUnitDetails {
  id: string;
  imeiValues: string[];
  searchTokens: string[];
  serialValues: string[];
  unitIndex: number;
}

export function getJoinedProduct(
  value: TransactionReviewProductRow | TransactionReviewProductRow[] | null
) {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function getJoinedVariant(
  value:
    | TransactionReviewVariantRow
    | TransactionReviewVariantRow[]
    | null
    | undefined
) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export function getTrimmedString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function toFiniteNumberOrNull(value: unknown) {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string' && value.trim() === '') {
    return null;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

export function collectStrings(
  value: unknown,
  keyMatcher?: (key: string) => boolean
) {
  const strings: string[] = [];

  function visit(node: unknown, parentKey?: string) {
    if (typeof node === 'string' || typeof node === 'number') {
      const normalized = String(node).trim();
      if (normalized && (!keyMatcher || (parentKey && keyMatcher(parentKey)))) {
        strings.push(normalized);
      }
      return;
    }

    if (!node || typeof node !== 'object') {
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item, parentKey);
      }
      return;
    }

    for (const [key, child] of Object.entries(
      node as Record<string, unknown>
    )) {
      visit(child, key);
    }
  }

  visit(value);
  return Array.from(new Set(strings));
}

export function collectDetailValues(values: unknown[], keys: Set<string>) {
  return Array.from(
    new Set(
      values.flatMap((value) =>
        collectStrings(value, (key) => keys.has(key)).map((item) => item.trim())
      )
    )
  ).filter(Boolean);
}

// Canonical UTC date matching the search RPC gate (identical index string).
export const toCanonicalSearchDate = (date: string) =>
  Number.isNaN(Date.parse(date)) ? date : new Date(date).toISOString();

export function buildSearchText(tokens: unknown[]) {
  return tokens
    .flatMap((token) => {
      if (token == null) {
        return [];
      }
      if (Array.isArray(token)) {
        return token;
      }
      return [token];
    })
    .map((token) => String(token).trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
}

export function getSupplierNameFromMetadata(
  metadata: Record<string, unknown> | null | undefined
) {
  if (!metadata) {
    return '';
  }

  for (const key of SUPPLIER_METADATA_KEYS) {
    const value = getTrimmedString(metadata[key]);
    if (value) {
      return value;
    }
  }

  return '';
}

function getObjectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getNonNegativeInteger(value: unknown) {
  const numericValue = toFiniteNumberOrNull(value);
  if (
    numericValue == null ||
    !Number.isInteger(numericValue) ||
    numericValue < 0
  ) {
    return null;
  }

  return numericValue;
}

function getOrderFulfillmentItems(value: unknown): Record<string, unknown>[] {
  const details = getObjectRecord(value);
  const items = details?.items;

  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => getObjectRecord(item))
    .filter((item): item is Record<string, unknown> => item != null);
}

function getFulfillmentOrderItemId(item: Record<string, unknown>) {
  return (
    getTrimmedString(item.orderItemId) || getTrimmedString(item.order_item_id)
  );
}

function getItemFulfillmentUnits(
  fulfillmentDetails: unknown,
  orderItemId: string
): FulfillmentUnitDetails[] {
  return getOrderFulfillmentItems(fulfillmentDetails)
    .filter((item) => getFulfillmentOrderItemId(item) === orderItemId)
    .map((item, index) => {
      const unitIndex =
        getNonNegativeInteger(item.unitIndex) ??
        getNonNegativeInteger(item.unit_index) ??
        index;
      const id = getTrimmedString(item.id) || `${orderItemId}:${unitIndex + 1}`;

      return {
        id,
        imeiValues: collectDetailValues([item], IMEI_KEYS),
        searchTokens: collectStrings(item),
        serialValues: collectDetailValues([item], SERIAL_KEYS),
        unitIndex,
      };
    });
}

function getInventoryUnitsArray(
  fulfillmentData: unknown
): Record<string, unknown>[] {
  const data = getObjectRecord(fulfillmentData);
  const units = data?.inventoryUnits;
  if (!Array.isArray(units)) {
    return [];
  }
  return units
    .map((unit) => getObjectRecord(unit))
    .filter((unit): unit is Record<string, unknown> => unit != null);
}

/**
 * Per-unit rows for serialized/claimed inventory, stored on
 * order_items.fulfillment_data.inventoryUnits. These have no explicit index —
 * position is the unit index. The reservation flow only mirrors single-unit
 * orders to orders.fulfillment_details, so multi-unit serialized lines are only
 * represented here.
 */
function getItemInventoryUnits(
  fulfillmentData: unknown,
  orderItemId: string
): FulfillmentUnitDetails[] {
  return getInventoryUnitsArray(fulfillmentData).map((unit, index) => {
    const identifierType = getTrimmedString(unit.identifierType).toLowerCase();
    const identifierValue = getTrimmedString(unit.identifierValue);
    const id =
      getTrimmedString(unit.inventoryUnitId) || `${orderItemId}:${index + 1}`;

    return {
      id,
      imeiValues:
        identifierType === 'imei' && identifierValue ? [identifierValue] : [],
      searchTokens: collectStrings(unit),
      serialValues:
        identifierType === 'serial' && identifierValue ? [identifierValue] : [],
      unitIndex: index,
    };
  });
}

/**
 * Merge the order-level fulfillment units with the item-level serialized
 * inventory units into a unitIndex→details map. Order-level records win when
 * both are present so single-unit mirrors keep precedence, while multi-unit
 * serialized lines (item-level only) still surface every unit.
 */
export function buildFulfillmentUnitIndex(
  orderFulfillmentDetails: unknown,
  itemFulfillmentData: unknown,
  orderItemId: string
): Map<number, FulfillmentUnitDetails> {
  const byIndex = new Map<number, FulfillmentUnitDetails>();
  for (const unit of getItemInventoryUnits(itemFulfillmentData, orderItemId)) {
    byIndex.set(unit.unitIndex, unit);
  }
  for (const unit of getItemFulfillmentUnits(
    orderFulfillmentDetails,
    orderItemId
  )) {
    byIndex.set(unit.unitIndex, unit);
  }
  return byIndex;
}

export function getSafeLegacyOrderDetails(
  fulfillmentDetails: unknown,
  orderItemCount: number,
  quantity: number
) {
  if (orderItemCount === 1 && quantity === 1) {
    return fulfillmentDetails;
  }

  return null;
}

export function getUnitCostByIndex(
  unitCosts: TransactionReviewUnitCostRow[] | null | undefined
) {
  const unitCostByIndex = new Map<number, TransactionReviewUnitCostRow>();

  for (const unitCost of unitCosts ?? []) {
    const unitIndex = getNonNegativeInteger(unitCost.unit_index);
    if (unitIndex != null && !unitCostByIndex.has(unitIndex)) {
      unitCostByIndex.set(unitIndex, unitCost);
    }
  }

  return unitCostByIndex;
}
