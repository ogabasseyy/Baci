import { normalizeCanonicalProductCondition } from './product-condition';

/**
 * Single TypeScript caller for the SQL offer-resolution authority
 * (`get_storefront_offer_resolution`, which owns identity liveness,
 * the live price basis, allocatable stock, and the M28 parent gate).
 * Every layer — search callers, web PDP, native PDP/cart, cart
 * validation, order verification, reprice — reads offers through this
 * module instead of restating the rules. Snapshot-driven surfaces
 * (PDPs render hydrated product snapshots, not live RPC rows) apply
 * the same rules through the pure helpers below.
 */

/** `${productId}::${offerId}` identity key shared by every consumer. */
export function makeOfferLineKey(productId: string, offerId: string): string {
  return `${productId}::${offerId}`;
}

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
 * Coerces one raw authority row (PostgREST decodes numerics as strings).
 * Returns null for rows without a product/offer identity.
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
    productId,
    offerId: offerIdText,
    condition:
      typeof condition === 'string' && condition !== '' ? condition : null,
    priceBasis: toFiniteNumber(
      record.price_basis ?? record.priceBasis ?? record.price
    ),
    allocatableStock: toFiniteNumber(
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
    parentEligible: Boolean(
      record.parent_eligible ?? record.parentEligible ?? true
    ),
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
 * The one live-offer fetch: a single batched authority call keyed by
 * `productId::offerId`. Throws OfferAuthorityInputError for malformed
 * ids (adapters fail closed) and Error for lookup failures.
 */
export async function fetchOfferResolutions(
  callRpc: OfferAuthorityRpcCall,
  args: { merchantId?: string | null; productIds: readonly string[] }
): Promise<Map<string, ResolvedOfferResolution>> {
  const unique = Array.from(new Set(args.productIds.filter((id) => id !== '')));
  if (unique.length === 0) return new Map();
  const malformed = unique.filter((id) => !isOfferAuthorityId(id));
  if (malformed.length > 0) throw new OfferAuthorityInputError(malformed);
  const { data, error } = await callRpc({
    p_merchant_id: args.merchantId ?? null,
    p_product_ids: unique,
  });
  if (error) throw new Error(error.message);
  return buildOfferResolutionMap(data);
}

export interface SelectableConditionOffer {
  id: string | number;
  condition?: string | null;
}

export interface ConditionOfferSelection {
  /** Canonical-or-raw selected condition; null/undefined selects nothing. */
  selectedCondition?: string | null;
  /** Advertised offer id (search/compare/route); honored on match. */
  preferredOfferId?: string | null;
  /**
   * Ordered advertised ids (explicit pick before route id); each is
   * honored on match before the condition fallback. Appended after
   * `preferredOfferId` when both are given.
   */
  preferredOfferIds?: ReadonlyArray<string | null | undefined>;
  /** Base-row entries suppress the match to keep the advertised price. */
  suppressMatch?: boolean;
  /**
   * Parent condition: same-condition selections belong to the parent
   * family, so the condition fallback resolves nothing. The preferred
   * id is still honored above this gate (explicit picks win).
   */
  parentCondition?: string | null;
  /** Prefer a raw condition spelling over an earlier canonical alias. */
  preferExactConditionMatch?: boolean;
}

/**
 * Offer identity for a selected condition, shared by the web PDP, the
 * native PDP, and the ogabassey PDP: suppression wins, then each
 * advertised id in order (when it names a member matching the
 * selection), then the condition fallback (exact spelling first when
 * requested, else the first canonical match, excluding the parent
 * family's own condition). A missing selection resolves only a
 * single-offer catalog.
 */
export function selectConditionOffer<T extends SelectableConditionOffer>(
  offers: readonly T[] | null | undefined,
  selection: ConditionOfferSelection = {}
): T | null {
  if (selection.suppressMatch) return null;
  if (!offers || offers.length === 0) return null;
  const {
    selectedCondition,
    preferredOfferId,
    preferredOfferIds,
    parentCondition,
    preferExactConditionMatch,
  } = selection;
  const normalizedSelected = selectedCondition
    ? normalizeCanonicalProductCondition(selectedCondition)
    : '';

  const orderedPreferredIds = [
    ...(preferredOfferId != null && preferredOfferId !== ''
      ? [preferredOfferId]
      : []),
    ...(preferredOfferIds ?? []).filter(
      (id): id is string => id != null && id !== ''
    ),
  ];
  for (const candidateId of orderedPreferredIds) {
    const preferred = offers.find(
      (offer) => String(offer.id) === String(candidateId)
    );
    if (!preferred) continue;
    if (normalizedSelected) {
      const normalizedPreferred = normalizeCanonicalProductCondition(
        preferred.condition ?? ''
      );
      if (
        normalizedPreferred !== '' &&
        normalizedPreferred === normalizedSelected
      ) {
        return preferred;
      }
    } else if (offers.length === 1) {
      return preferred;
    }
  }

  if (!normalizedSelected) {
    return offers.length === 1 ? offers[0] : null;
  }

  // Same-condition selections belong to the parent family, never to an
  // offer row (a null parent defaults to `new`, matching the PDP rule
  // that never purchases through a same-condition offer).
  if (parentCondition !== undefined) {
    const normalizedParent =
      normalizeCanonicalProductCondition(parentCondition ?? '') || 'new';
    if (normalizedSelected === normalizedParent) return null;
  }

  if (preferExactConditionMatch) {
    const exact = offers.find(
      (offer) => (offer.condition ?? null) === selectedCondition
    );
    if (exact) return exact;
  }
  return (
    offers.find(
      (offer) =>
        normalizeCanonicalProductCondition(offer.condition ?? '') ===
        normalizedSelected
    ) ?? null
  );
}

/**
 * Display price basis for a selected offer: the finite offer price, or
 * the parent price when the snapshot carries none.
 */
export function resolveOfferPriceBasis(
  offerPrice: unknown,
  parentPrice: number
): number {
  return toFiniteOfferPrice(offerPrice) ?? parentPrice;
}

export interface OfferStockBase {
  effective_policy?: string | null;
  inventory_tracking_policy?: string | null;
  /** Strict serialized base units (folded snapshot stock or live units). */
  availableUnits?: number | null;
  /** Effective parent stock (scalar/legacy fallback already applied). */
  parentStock: number;
}

/**
 * Allocatable stock for a snapshot offer row, mirroring the SQL
 * authority: the finite scalar binds everywhere; strict caps it by the
 * base units; a null scalar inherits the parent stock (legacy/strict)
 * and stays unbounded under serialized_then_unlimited. Returns null
 * for unbounded; callers map it to their own sentinel.
 */
export function resolveOfferAllocatableStock(
  offerScalar: unknown,
  base: OfferStockBase
): number | null {
  const scalar = toFiniteStockQuantity(offerScalar);
  const policy = base.effective_policy ?? base.inventory_tracking_policy;
  const parentStock = Math.max(0, Math.floor(base.parentStock));
  if (policy === 'serialized_strict') {
    const units =
      base.availableUnits === null || base.availableUnits === undefined
        ? 0
        : Math.max(0, Math.floor(base.availableUnits));
    return Math.min(scalar === null ? parentStock : scalar, units);
  }
  if (policy === 'serialized_then_unlimited') {
    return scalar;
  }
  return scalar === null ? parentStock : scalar;
}
