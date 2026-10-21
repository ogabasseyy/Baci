import { toFiniteNumber } from './to-finite-number';

/** One coerced authority row: the live economics of an active offer. */
export interface ResolvedOfferResolution {
  productId: string;
  offerId: string;
  /** Raw live condition spelling (fulfillment binds this exact row). */
  condition: string | null;
  /** Live price basis; null when the row carries no finite price. */
  priceBasis: number | null;
  /**
   * Effective allocatable units from SQL. Null means unbounded
   * (unlimited policy with no scalar); callers map it to their own
   * sentinel (Infinity / MAX_SAFE_INTEGER).
   */
  allocatableStock: number | null;
  /** M28 parent shape computed in SQL (flag, variant, live variants). */
  parentEligible: boolean;
  effectivePolicy: string | null;
  /** Strict serialized base units (null unless strict). */
  availableUnits: number | null;
  /** Display columns riding along so detail surfaces need no second lookup. */
  compareAtPrice?: number | null;
  grade?: string | null;
  conditionNotes?: string | null;
  images?: unknown;
}

/**
 * Finite stock scalar (floored), or null when absent. Deliberately
 * NOT clamped: a negative allocation from a partial projection must
 * keep failing schema-validated surfaces as unavailable (see the MCP
 * output contract), while every quantity comparison (> 0) already
 * treats it as unpurchasable.
 */
function toUnclampedStockQuantity(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  return parsed === null ? null : Math.floor(parsed);
}

/** Eligibility flag: true only for boolean true or the string 'true'. */
function toEligibilityFlag(value: unknown): boolean {
  return value === true || value === 'true';
}

/**
 * Coerces one raw authority row (PostgREST decodes numerics as strings).
 * Returns null for rows without a product/offer identity. Identity ids
 * are lowercased (UUID hex is case-insensitive; Postgres canonicalizes
 * to lowercase) so consumers comparing against caller-supplied ids
 * meet regardless of spelling.
 */
export function coerceOfferAuthorityRow(
  row: unknown
): ResolvedOfferResolution | null {
  if (typeof row !== 'object' || row === null) return null;
  const record = row as Record<string, unknown>;
  const productId = record.product_id ?? record.productId;
  const offerId = record.offer_id ?? record.offerId ?? record.id;
  if (typeof productId !== 'string' || productId === '') return null;
  if (typeof offerId !== 'string' && typeof offerId !== 'number') return null;
  const offerIdText = String(offerId);
  if (offerIdText === '') return null;
  const condition = record.condition;
  const availableUnits = toFiniteNumber(
    record.available_units ?? record.availableUnits
  );
  const grade = record.grade;
  const conditionNotes = record.condition_notes ?? record.conditionNotes;
  return {
    productId: productId.toLowerCase(),
    offerId: offerIdText.toLowerCase(),
    condition:
      typeof condition === 'string' && condition !== '' ? condition : null,
    priceBasis: toFiniteNumber(
      record.price_basis ?? record.priceBasis ?? record.price
    ),
    allocatableStock: toUnclampedStockQuantity(
      record.allocatable_stock ??
        record.allocatableStock ??
        record.stock_quantity
    ),
    compareAtPrice: toFiniteNumber(
      record.compare_at_price ?? record.compareAtPrice
    ),
    grade: typeof grade === 'string' && grade !== '' ? grade : null,
    conditionNotes:
      typeof conditionNotes === 'string' && conditionNotes !== ''
        ? conditionNotes
        : null,
    images: record.images,
    // A row without the flag fails closed: schema drift, partial
    // projections, or a future rename must never read as eligible.
    // Parsed explicitly (never Boolean()) because a stringly-typed
    // 'false' from a proxy or partial projection is truthy.
    parentEligible: toEligibilityFlag(
      record.parent_eligible ?? record.parentEligible
    ),
    effectivePolicy:
      typeof (record.effective_policy ?? record.effectivePolicy) === 'string'
        ? String(record.effective_policy ?? record.effectivePolicy)
        : null,
    availableUnits:
      availableUnits === null ? null : Math.max(0, Math.floor(availableUnits)),
  };
}
