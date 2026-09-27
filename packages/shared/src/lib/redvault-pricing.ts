import { REDVAULT_PRICING_TIERS } from '../constants/redvault-pricing';
import type {
  RedvaultAuthoritativeLine,
  RedvaultItemAllocation,
  RedvaultPricingResult,
} from '../contracts/redvault-quote';
import { REDVAULT_MAX_ALLOCATION_UNITS_PER_QUOTE } from '../contracts/redvault-quote';
import { isRedvaultEligibleProduct } from './redvault-eligibility';

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

type ValidatedLine = RedvaultAuthoritativeLine & {
  eligible: boolean;
  lineSubtotalKobo: number;
  lineKey: string;
};

function requireSafeInteger(
  value: unknown,
  name: string,
  minimum: number
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(
      `${name} must be a ${minimum === 0 ? 'nonnegative' : 'positive'} safe integer`
    );
  }
  return value as number;
}

function requireText(
  value: unknown,
  name: string,
  nullable = false
): string | null {
  if (nullable && value === null) {
    return null;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function stableAttributes(value: unknown): string {
  if (value === null) {
    return '{}';
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('variantAttributes must be an object or null');
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (
    entries.some(([key, entry]) => !key.trim() || typeof entry !== 'string')
  ) {
    throw new Error(
      'variantAttributes must contain non-empty string keys and string values'
    );
  }
  const normalized = entries.map(
    ([key, entry]) => [key.trim(), entry] as const
  );
  if (new Set(normalized.map(([key]) => key)).size !== normalized.length) {
    throw new Error('variantAttributes contains duplicate normalized keys');
  }
  normalized.sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(normalized);
}

function addSafely(left: number, right: number, name: string): number {
  if (right > MAX_SAFE_INTEGER - left) {
    throw new Error(`${name} overflow`);
  }
  return left + right;
}

function validateLine(input: unknown): ValidatedLine {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('line must be an object');
  }
  const line = input as RedvaultAuthoritativeLine;
  const unitPriceKobo = requireSafeInteger(
    line.unitPriceKobo,
    'unitPriceKobo',
    0
  );
  const quantity = requireSafeInteger(line.quantity, 'quantity', 1);
  if (
    unitPriceKobo !== 0 &&
    quantity > Math.floor(MAX_SAFE_INTEGER / unitPriceKobo)
  ) {
    throw new Error('line subtotal overflow');
  }
  const productId = requireText(line.productId, 'productId') as string;
  const itemId = requireText(line.itemId, 'itemId') as string;
  const variantId = requireText(line.variantId, 'variantId', true);
  const condition = requireText(line.condition, 'condition', true);
  const brand = requireText(line.brand, 'brand', true);
  const name = requireText(line.name, 'name', true);
  const vatCategoryCode = requireText(
    line.vatCategoryCode,
    'vatCategoryCode'
  ) as string;
  const vatRateBasisPoints = requireSafeInteger(
    line.vatRateBasisPoints,
    'vatRateBasisPoints',
    0
  );
  const persistedItemOrder = requireSafeInteger(
    line.persistedItemOrder,
    'persistedItemOrder',
    1
  );
  if (line.taxBasis !== 'exclusive') {
    throw new Error('taxBasis must be exclusive');
  }
  const lineKey = JSON.stringify([
    productId,
    variantId,
    condition,
    stableAttributes(line.variantAttributes),
    unitPriceKobo,
    vatCategoryCode.toUpperCase(),
    vatRateBasisPoints,
    line.taxBasis,
  ]);
  return {
    ...line,
    brand,
    condition,
    eligible: isRedvaultEligibleProduct({ brand, name }),
    itemId,
    lineKey,
    lineSubtotalKobo: unitPriceKobo * quantity,
    name,
    persistedItemOrder,
    productId,
    quantity,
    unitPriceKobo,
    variantId,
    vatCategoryCode,
    vatRateBasisPoints,
  };
}

function compareLines(left: ValidatedLine, right: ValidatedLine): number {
  return (
    left.persistedItemOrder - right.persistedItemOrder ||
    left.itemId.localeCompare(right.itemId)
  );
}

function roundDiscountKobo(subtotalKobo: number, percent: number): number {
  if (subtotalKobo > Math.floor((MAX_SAFE_INTEGER - 50) / percent)) {
    throw new Error('discount calculation overflow');
  }
  return Math.floor((subtotalKobo * percent + 50) / 100);
}

export function calculateRedvaultPricing(
  lines: unknown
): RedvaultPricingResult {
  if (!Array.isArray(lines)) {
    throw new Error('lines must be an array');
  }
  if (lines.length > REDVAULT_MAX_ALLOCATION_UNITS_PER_QUOTE) {
    throw new Error(
      `lines exceed the maximum ${REDVAULT_MAX_ALLOCATION_UNITS_PER_QUOTE} allocation units per quote`
    );
  }
  const validated = lines.map(validateLine).sort(compareLines);
  const itemIds = new Set<string>();
  let productSubtotalKobo = 0;
  let eligibleSubtotalKobo = 0;
  let allocationUnitCount = 0;
  const groups = new Map<string, ValidatedLine[]>();
  for (const line of validated) {
    if (itemIds.has(line.itemId)) {
      throw new Error('itemId must be unique');
    }
    itemIds.add(line.itemId);
    allocationUnitCount = addSafely(
      allocationUnitCount,
      line.quantity,
      'allocation unit count'
    );
    if (allocationUnitCount > REDVAULT_MAX_ALLOCATION_UNITS_PER_QUOTE) {
      throw new Error(
        `lines exceed the maximum ${REDVAULT_MAX_ALLOCATION_UNITS_PER_QUOTE} allocation units per quote`
      );
    }
    productSubtotalKobo = addSafely(
      productSubtotalKobo,
      line.lineSubtotalKobo,
      'product subtotal'
    );
    if (!line.eligible) {
      continue;
    }
    eligibleSubtotalKobo = addSafely(
      eligibleSubtotalKobo,
      line.lineSubtotalKobo,
      'eligible subtotal'
    );
    const group = groups.get(line.lineKey);
    if (group) {
      group.push(line);
    } else {
      groups.set(line.lineKey, [line]);
    }
  }
  const byItemId = new Map<string, RedvaultItemAllocation>(
    validated.map((line) => [
      line.itemId,
      {
        discountKobo: 0,
        eligible: line.eligible,
        itemId: line.itemId,
        unitDiscountsKobo: Array.from({ length: line.quantity }, () => 0),
        unitNetAmountsKobo: Array.from(
          { length: line.quantity },
          () => line.unitPriceKobo
        ),
      },
    ])
  );
  let discountKobo = 0;
  const discountPercent =
    eligibleSubtotalKobo < REDVAULT_PRICING_TIERS.thresholdKobo
      ? REDVAULT_PRICING_TIERS.belowThresholdPercent
      : REDVAULT_PRICING_TIERS.atOrAboveThresholdPercent;
  for (const group of groups.values()) {
    const subtotalKobo = group.reduce(
      (total, line) =>
        addSafely(total, line.lineSubtotalKobo, 'group subtotal'),
      0
    );
    const groupDiscountKobo = roundDiscountKobo(subtotalKobo, discountPercent);
    discountKobo = addSafely(discountKobo, groupDiscountKobo, 'discount');
    const unitCount = group.reduce(
      (total, line) => addSafely(total, line.quantity, 'group unit count'),
      0
    );
    const baseDiscountKobo = Math.floor(groupDiscountKobo / unitCount);
    let remainderKobo = groupDiscountKobo % unitCount;
    for (const line of group) {
      const allocation = byItemId.get(line.itemId) as RedvaultItemAllocation;
      for (let unitIndex = 0; unitIndex < line.quantity; unitIndex += 1) {
        const unitDiscountKobo =
          baseDiscountKobo + (remainderKobo-- > 0 ? 1 : 0);
        allocation.unitDiscountsKobo[unitIndex] = unitDiscountKobo;
        allocation.unitNetAmountsKobo[unitIndex] =
          line.unitPriceKobo - unitDiscountKobo;
        allocation.discountKobo = addSafely(
          allocation.discountKobo,
          unitDiscountKobo,
          'item discount'
        );
      }
    }
  }
  return {
    allocations: validated.map(
      (line) => byItemId.get(line.itemId) as RedvaultItemAllocation
    ),
    discountKobo,
    eligible: eligibleSubtotalKobo > 0,
    eligibleSubtotalKobo,
    productSubtotalKobo,
  };
}
