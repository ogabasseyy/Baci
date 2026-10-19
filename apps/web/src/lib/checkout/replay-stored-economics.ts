/**
 * Stored-economics projection for idempotent offer-order replays.
 *
 * The retry restores the keyed order's tax, discount, per-line conditions,
 * and per-line assurance fees so the identical payload hashes identically.
 * This module holds the pure projection: identity keys, the unambiguous
 * offerless fallback, amount coercion, and the stored-items fold. The
 * database read itself stays with the resolver.
 */

export interface StoredReplayLine {
  condition: string | null;
  fee: number | null;
}

export interface StoredReplayEconomics {
  taxAmount: number | null;
  discountAmount: number | null;
  /** Fee-identity key → stored lines in projection order. */
  lines: Map<string, StoredReplayLine[]>;
  /**
   * Reduced-identity (product/quantity/assurance, no offer) key →
   * stored lines whose offer row was deleted (ON DELETE SET NULL).
   * Retry lines match here only when exactly one candidate exists.
   */
  offerlessLines: Map<string, StoredReplayLine[]>;
}

export const EMPTY_REPLAY_ECONOMICS: StoredReplayEconomics = {
  taxAmount: null,
  discountAmount: null,
  lines: new Map<string, StoredReplayLine[]>(),
  offerlessLines: new Map<string, StoredReplayLine[]>(),
};

/**
 * Fee-identity key shared by the stored projection and the retry payload.
 * Mirrors the idempotency hash's normalization (trimmed/lowercased text,
 * finite-number-or-0, strict boolean). Every field must be unchanged
 * between the hashed request and the stored row: quantity and
 * has_assurance pass through untouched, while price does not — the
 * order persistence layer stores the live (or negotiated) price and the
 * hash covers the submitted price, so a days-old stale quote would never
 * match its stored row on price. Residual ambiguity (same key, different
 * stored fees) requires distinct negotiated prices on otherwise identical
 * lines, which both carts merge away — direct-API only, and a swap
 * there fails closed into a conflict, never silent corruption.
 * Condition stays out for the same reason: the first attempt rewrites
 * alias spellings to the live offer spelling before hashing.
 */
export function replayLineIdentityKey(parts: {
  productId: unknown;
  offerId: unknown;
  quantity: unknown;
  hasAssurance: unknown;
}): string {
  const text = (raw: unknown): string =>
    typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  const num = (raw: unknown): number => {
    const value =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && raw.trim() !== ''
          ? Number(raw)
          : Number.NaN;
    return Number.isFinite(value) ? value : 0;
  };
  return [
    text(parts.productId),
    text(parts.offerId),
    num(parts.quantity),
    parts.hasAssurance === true,
  ].join('::');
}

/**
 * Pops the single offerless stored line for a reduced identity, or
 * returns null when zero or several candidates exist. Consuming (not
 * peeking) keeps repeated identical retry lines honest: only the
 * first replays from the stored row, later ones fail open per line.
 */
export function consumeUnambiguousOfferlessLine(
  offerlessLines: Map<string, StoredReplayLine[]>,
  parts: {
    productId: unknown;
    quantity: unknown;
    hasAssurance: unknown;
  }
): StoredReplayLine | null {
  const key = replayLineIdentityKey({ ...parts, offerId: null });
  const queue = offerlessLines.get(key);
  if (queue?.length !== 1) {
    return null;
  }
  return queue.shift() ?? null;
}

/**
 * PostgREST may decode numeric as a string; blank/null stays fail-open.
 */
export function coerceStoredReplayAmount(raw: unknown): number | null {
  const value =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw)
        : Number.NaN;
  return Number.isFinite(value) ? value : null;
}

interface StoredReplayItemEntry {
  product_id?: unknown;
  offer_id?: unknown;
  condition?: unknown;
  assurance_fee?: unknown;
  quantity?: unknown;
  has_assurance?: unknown;
}

/**
 * Folds the stored order's items projection into fee-identity queues.
 * An order can repeat one product+offer across lines (distinct
 * quantities, prices, or assurance choices, hence distinct fees).
 * The idempotency hash sorts lines, so a reordered retry is
 * hash-equivalent and request position cannot pair stored fees to
 * payload lines — match by fee-identity instead. Full duplicates
 * queue behind one key and consume in order; their fees are
 * interchangeable by construction. Lines whose offer row was deleted
 * (ON DELETE SET NULL) queue in the offerless map instead.
 */
export function projectStoredReplayLines(
  items: unknown
): Pick<StoredReplayEconomics, 'lines' | 'offerlessLines'> {
  const lines = new Map<string, StoredReplayLine[]>();
  const offerlessLines = new Map<string, StoredReplayLine[]>();
  if (!Array.isArray(items)) {
    return { lines, offerlessLines };
  }
  for (const entry of items as StoredReplayItemEntry[]) {
    if (entry?.product_id == null) continue;
    const key = replayLineIdentityKey({
      productId: entry.product_id,
      offerId: entry.offer_id,
      quantity: entry.quantity,
      hasAssurance: entry.has_assurance,
    });
    const target = entry?.offer_id == null ? offerlessLines : lines;
    const queue = target.get(key) ?? [];
    queue.push({
      condition:
        typeof entry?.condition === 'string' && entry.condition !== ''
          ? entry.condition
          : null,
      fee: coerceStoredReplayAmount(entry?.assurance_fee),
    });
    target.set(key, queue);
  }
  return { lines, offerlessLines };
}
