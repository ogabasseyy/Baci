import 'server-only';
import { piggyvestCustomerLookupSchema } from '@/schemas/piggyvest-customer-lookup';

export type PrimaryWalletCustomerLookup =
  | { kind: 'none' }
  | { kind: 'found'; customerId: string }
  | { kind: 'unknown' };

/**
 * Before a reclaimed onboarding intent is dispatched again, ask PiggyVest
 * whether an earlier ambiguous dispatch already created the customer.
 * Only a complete answer counts: 'none' when the listing is complete and
 * holds no customer with our identifier, 'found' for exactly one, and
 * 'unknown' for anything else (failure, more pages, several matches), which
 * must never lead to a create.
 */
export async function lookupPrimaryWalletCustomer(input: {
  thirdPartyIdentifier: string;
  findCustomers: (thirdPartyIdentifier: string) => Promise<unknown>;
}): Promise<PrimaryWalletCustomerLookup> {
  let response: unknown;
  try {
    response = await input.findCustomers(input.thirdPartyIdentifier);
  } catch {
    return { kind: 'unknown' };
  }
  const parsed = piggyvestCustomerLookupSchema.safeParse(response);
  if (!parsed.success || parsed.data.paginatedPayload.pageInfo.hasNextPage)
    return { kind: 'unknown' };
  const matches = parsed.data.paginatedPayload.edges.filter(
    (edge) => edge.third_party_identifier === input.thirdPartyIdentifier
  );
  // The filter is server-side: any listed customer that does not echo our
  // identifier means the answer cannot be trusted as complete.
  if (matches.length !== parsed.data.paginatedPayload.edges.length)
    return { kind: 'unknown' };
  if (matches.length === 0) return { kind: 'none' };
  return matches.length === 1
    ? { kind: 'found', customerId: matches[0].id }
    : { kind: 'unknown' };
}
