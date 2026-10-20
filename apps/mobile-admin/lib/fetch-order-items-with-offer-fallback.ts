import { isMissingSchemaColumn } from './is-missing-transaction-review-schema-column';
import type { TransactionReviewQueryError } from './transaction-review-fallback-types';

/**
 * Offer columns the mobile-admin order-details query selects. When the
 * app binary runs against a database where the label-snapshot
 * migrations have not yet applied, PostgREST reports them missing
 * from the schema cache — strip exactly those and retry once instead
 * of hard-failing the whole screen (mirrors the transaction-review
 * omit-and-retry fallback).
 */
const ORDER_DETAILS_OFFER_COLUMNS = [
  'offer_id',
  'product_offer_id',
  'offer_id_snapshot',
  'offer_grade',
  'offer_condition_notes',
  'offer_labels_snapshotted',
] as const;

export function stripMissingOrderOfferColumns(
  selector: string,
  missing: readonly string[]
): string {
  if (missing.length === 0) return selector;
  const dropped = new Set(missing);
  // Split top-level commas only: a naive split would also match a
  // stripped name inside an embedded relation selection such as
  // `products(name, offer_id)`. Parenthesized groups pass through
  // byte-for-byte.
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of selector) {
    if (char === '(') depth += 1;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts
    .map((part) => part.trim())
    .filter((part) => part !== '' && !dropped.has(part))
    .join(',');
}

export interface OrderItemsFallbackResult {
  data: unknown;
  error: TransactionReviewQueryError;
}

export async function fetchOrderItemsWithOfferFallback(
  run: (columns: string) => PromiseLike<OrderItemsFallbackResult>,
  columns: string
): Promise<OrderItemsFallbackResult> {
  // PostgREST reports only the first missing column, so one strip is
  // not enough when the schema predates several offer columns: repeat
  // the detect/strip/query cycle until the query succeeds or the error
  // is no longer recognized offer-column drift. Bounded by the offer
  // column count plus the final attempt — each pass strips at least one
  // column, so the loop always terminates.
  let remaining = [...ORDER_DETAILS_OFFER_COLUMNS];
  let current = columns;
  let result = await run(current);
  while (result.error) {
    const missing = remaining.filter((column) =>
      isMissingSchemaColumn(result.error, column)
    );
    // Non-schema errors (auth, network, RLS) and drift in columns we
    // do not own retry-safe must keep failing loud, never degrade
    // silently.
    if (missing.length === 0) return result;
    remaining = remaining.filter((column) => !missing.includes(column));
    current = stripMissingOrderOfferColumns(current, missing);
    result = await run(current);
  }
  return result;
}
