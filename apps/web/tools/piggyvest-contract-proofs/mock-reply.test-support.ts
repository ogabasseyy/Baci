/**
 * Typed access to the mock sandbox's replies in tests, without `any`: the body
 * is `unknown` until a caller names the shape it expects.
 */

export interface MockRow {
  [key: string]: unknown;
  id: string;
}

export interface MockPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
  previousCursor: string | null;
}

export interface MockPage {
  edges: MockRow[];
  pageInfo: MockPageInfo;
}

export interface MockPagedData {
  paginatedPayload: MockPage;
}

export interface MockCreated {
  customer_id: string;
  wallet_id: string;
  new_customer: boolean;
  third_party_identifier?: string | null;
}

export interface MockEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

/** The reply envelope, with `data` typed as the caller expects. */
export function envelopeOf<T = Record<string, unknown>>(reply: {
  body: unknown;
}): MockEnvelope<T> {
  return reply.body as MockEnvelope<T>;
}

/** Just the `data` of a reply. */
export function dataOf<T = Record<string, unknown>>(reply: {
  body: unknown;
}): T {
  return envelopeOf<T>(reply).data;
}
