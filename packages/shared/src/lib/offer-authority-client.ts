import { makeOfferLineKey } from './offer-line-key';

/**
 * TypeScript client for the SQL offer-resolution authority
 * (`get_storefront_offer_resolution`, which owns identity liveness,
 * the live price basis, allocatable stock, and the M28 parent gate).
 * Every live layer reads offers through `fetchOfferResolutions`
 * instead of restating the rules.
 */

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isOfferAuthorityId(value: unknown): value is string {
  return typeof value === 'string' && uuidRegex.test(value);
}

/** Thrown when the caller passes malformed ids; adapters fail closed. */
export class OfferAuthorityInputError extends Error {
  readonly ids: string[];

  constructor(ids: string[]) {
    super(`Invalid offer authority ids: ${ids.join(', ')}`);
    this.name = 'OfferAuthorityInputError';
    this.ids = ids;
  }
}

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
  /** M28 parent gate computed in SQL (flag, variant, live variants). */
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

function toFiniteNumber(value: unknown): number | null {
  // Number(null) and Number('') are 0 — an unpriced row must stay null
  // rather than pricing checks at zero.
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Finite offer price, or null when the row carries none. */
export function toFiniteOfferPrice(value: unknown): number | null {
  return toFiniteNumber(value);
}

/** Finite stock scalar (floored, clamped at zero), or null when absent. */
export function toFiniteStockQuantity(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  return parsed === null ? null : Math.max(0, Math.floor(parsed));
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
    parentEligible: Boolean(record.parent_eligible ?? record.parentEligible),
    effectivePolicy:
      typeof (record.effective_policy ?? record.effectivePolicy) === 'string'
        ? String(record.effective_policy ?? record.effectivePolicy)
        : null,
    availableUnits:
      availableUnits === null ? null : Math.max(0, Math.floor(availableUnits)),
  };
}

/** Authority rows keyed by `productId::offerId`. */
export function buildOfferResolutionMap(
  rows: unknown
): Map<string, ResolvedOfferResolution> {
  const map = new Map<string, ResolvedOfferResolution>();
  if (!Array.isArray(rows)) return map;
  for (const row of rows) {
    const coerced = coerceOfferAuthorityRow(row);
    if (coerced)
      map.set(makeOfferLineKey(coerced.productId, coerced.offerId), coerced);
  }
  return map;
}

export type OfferAuthorityRpcCall = (args: {
  p_merchant_id: string | null;
  p_product_ids: string[];
}) => Promise<{ data: unknown; error: { message: string } | null }>;

/**
 * Largest authority batch per scope: unscoped (NULL merchant) calls
 * are capped at 200 ids in SQL, merchant-scoped calls at 1000. Chunk
 * to the caller's cap so scoped batches stay single-RPC.
 */
const AUTHORITY_BATCH_SIZE_UNSCOPED = 200;
const AUTHORITY_BATCH_SIZE_SCOPED = 1000;

/**
 * The one live-offer fetch: batched authority calls (chunked to the
 * SQL batch cap for the caller's scope) merged into one map keyed by
 * `productId::offerId`. Chunks run serially by design — merge order
 * stays deterministic and a chunk failure fails the whole lookup
 * closed with no partial map. Throws OfferAuthorityInputError for
 * malformed ids (adapters fail closed) and Error for lookup failures.
 */
export async function fetchOfferResolutions(
  callRpc: OfferAuthorityRpcCall,
  args: { merchantId?: string | null; productIds: readonly string[] }
): Promise<Map<string, ResolvedOfferResolution>> {
  // Null/undefined merchant is unscoped (valid); a supplied merchant
  // must be a uuid — otherwise Postgres raises 22P02 and callers
  // misclassify the lookup as a 500 instead of fail-closed input.
  if (
    args.merchantId !== undefined &&
    args.merchantId !== null &&
    !isOfferAuthorityId(args.merchantId)
  ) {
    throw new OfferAuthorityInputError([args.merchantId]);
  }
  const distinct = Array.from(
    new Set(args.productIds.filter((id) => id !== ''))
  );
  if (distinct.length === 0) return new Map();
  const malformed = distinct.filter((id) => !isOfferAuthorityId(id));
  if (malformed.length > 0) throw new OfferAuthorityInputError(malformed);
  const merged = new Map<string, ResolvedOfferResolution>();
  const batchSize =
    args.merchantId != null
      ? AUTHORITY_BATCH_SIZE_SCOPED
      : AUTHORITY_BATCH_SIZE_UNSCOPED;
  for (let index = 0; index < distinct.length; index += batchSize) {
    const { data, error } = await callRpc({
      p_merchant_id: args.merchantId ?? null,
      p_product_ids: distinct.slice(index, index + batchSize),
    });
    if (error) throw new Error(error.message);
    for (const [key, resolution] of buildOfferResolutionMap(data)) {
      merged.set(key, resolution);
    }
  }
  return merged;
}
