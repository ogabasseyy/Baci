import { resolvePiggyvestStagingSyntheticIdentity } from '@/lib/piggyvest/staging-synthetic-identity';
import { pickString } from './loose-schemas';
import type { QaIdentity } from './provider-ops';
import type { ProviderReads } from './provider-reads';
import { usableList } from './read-rules';

export type DiscoveryReason = 'found' | 'none' | 'ambiguous' | 'unverifiable';

export interface Discovery {
  customerId: string | null;
  reason: DiscoveryReason;
  /** The matching list row (never emitted; for registering names with the redactor). */
  row: unknown;
}

/**
 * A customer returned by a lookup is selected only on PROOF it belongs to
 * this QA key: its row echoes our exact third_party_identifier, or carries
 * the deterministic synthetic email derived from the QA key. Anything else,
 * including a provider that ignores the filter and returns unrelated
 * customers, is refused, because the id is later used as the owner of
 * customer-scoped mutations (sub-wallet creation).
 */
export function selectQaCustomer(edges: unknown[], qa: QaIdentity): Discovery {
  if (edges.length === 0)
    return { customerId: null, reason: 'none', row: undefined };
  const syntheticEmail = resolvePiggyvestStagingSyntheticIdentity(
    qa.qaKey
  ).email.toLowerCase();
  const verified = edges.filter((edge) => {
    const echoed = pickString(edge, ['third_party_identifier']);
    if (echoed !== null && echoed !== qa.thirdPartyIdentifier) return false;
    return (
      echoed === qa.thirdPartyIdentifier ||
      pickString(edge, ['email'])?.toLowerCase() === syntheticEmail
    );
  });
  if (verified.length > 1)
    return { customerId: null, reason: 'ambiguous', row: undefined };
  const id = pickString(verified[0], ['customer_id', 'id']);
  return id
    ? { customerId: id, reason: 'found', row: verified[0] }
    : { customerId: null, reason: 'unverifiable', row: undefined };
}

export async function discoverQaCustomer(
  api: Pick<ProviderReads, 'customersByIdentifier'>,
  qa: QaIdentity
): Promise<Discovery> {
  const call = await api.customersByIdentifier(qa.thirdPartyIdentifier);
  // A failed lookup, or a list we do not recognise, proves nothing about who
  // exists: never read it as "no customer" and never select from its rows.
  const list = usableList(call);
  if (!list)
    return { customerId: null, reason: 'unverifiable', row: undefined };
  return selectQaCustomer(list.edges, qa);
}

/**
 * A create answer that is not provably a brand-new customer (`new_customer`
 * false or absent) may belong to someone else: returnIfExist matches on BVN or
 * email, and two QA keys can derive the same synthetic BVN. Such a customer is
 * usable only if a lookup by THIS key's identifier verifies that same id.
 * Anything else, including a lookup that failed, is refused (fails closed).
 */
export async function verifiesCreatedCustomer(
  api: Pick<ProviderReads, 'customersByIdentifier'>,
  qa: QaIdentity,
  customerId: string
): Promise<boolean> {
  const found = await discoverQaCustomer(api, qa);
  return found.reason === 'found' && found.customerId === customerId;
}
