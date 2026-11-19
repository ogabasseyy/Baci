import type { GoogleMerchantListing } from '@/app/api/feed/google-merchant/feed-builder';
import type { CrossRemListingBinding } from '@/schemas/crossrem-listing-binding';
import { getSellableIdentity, sellableIdentityKey } from './sellable-identity';

export function seedBindingCandidates(rows: GoogleMerchantListing[]) {
  const byId = new Map<string, CrossRemListingBinding | null>();
  const identityCounts = new Map<string, number>();
  for (const row of rows) {
    const identity = getSellableIdentity(row);
    const binding =
      identity && !byId.has(row.id) ? { listingId: row.id, ...identity } : null;
    byId.set(row.id, binding);
    if (identity) {
      const key = sellableIdentityKey(identity);
      identityCounts.set(key, (identityCounts.get(key) ?? 0) + 1);
    }
  }

  const bindings: CrossRemListingBinding[] = [];
  const unresolvedListingIds: string[] = [];
  for (const id of [...byId.keys()].sort()) {
    const binding = byId.get(id);
    if (binding && identityCounts.get(sellableIdentityKey(binding)) === 1) {
      bindings.push(binding);
    } else {
      unresolvedListingIds.push(id);
    }
  }

  return { bindings, unresolved_listing_ids: unresolvedListingIds };
}
