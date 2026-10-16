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
  return selector
    .split(',')
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
