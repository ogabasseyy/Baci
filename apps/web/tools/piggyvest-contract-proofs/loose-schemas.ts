import { z } from 'zod';

/**
 * Tolerant parsers for provider responses whose exact shape the live run has
 * to confirm. They accept extra fields and report which container held a
 * list, so an unexpected shape becomes a finding rather than a crash.
 */

export const createDataSchema = z.looseObject({
  customer_id: z.string().min(1),
  wallet_id: z.string().min(1),
  new_customer: z.boolean().optional(),
});

export const walletDataSchema = z.looseObject({
  id: z.string().min(1),
  api_customer_id: z.string().nullish(),
  balance: z.number().int(),
  withdrawal_count: z.number().int().nonnegative().optional(),
  created_at: z.string().nullish(),
  name: z.string().nullish(),
});

const pageInfoSchema = z.looseObject({
  hasNextPage: z.boolean().optional(),
  endCursor: z.string().nullish(),
  previousCursor: z.string().nullish(),
});

export type ListContainer =
  | 'paginatedPayload.edges'
  | 'edges'
  | 'array'
  | 'unknown';

export interface ExtractedList {
  container: ListContainer;
  edges: unknown[];
  pageInfo: z.infer<typeof pageInfoSchema> | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function extractEdges(data: unknown): ExtractedList {
  if (Array.isArray(data))
    return { container: 'array', edges: data, pageInfo: null };
  const top = asRecord(data);
  const nested = asRecord(top?.paginatedPayload);
  const pick = (
    holder: Record<string, unknown> | null,
    container: ListContainer
  ): ExtractedList | null => {
    if (!holder || !Array.isArray(holder.edges)) return null;
    const info = pageInfoSchema.safeParse(holder.pageInfo);
    return {
      container,
      edges: holder.edges,
      pageInfo: info.success ? info.data : null,
    };
  };
  return (
    pick(nested, 'paginatedPayload.edges') ??
    pick(top, 'edges') ?? { container: 'unknown', edges: [], pageInfo: null }
  );
}

export function pickString(
  value: unknown,
  keys: readonly string[]
): string | null {
  const record = asRecord(value);
  for (const key of keys) {
    const candidate = record?.[key];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return null;
}

/** Ownership is proven only by an explicit, matching `api_customer_id`. */
export function isOwnedBy(walletData: unknown, customerId: string): boolean {
  return asRecord(walletData)?.api_customer_id === customerId;
}
