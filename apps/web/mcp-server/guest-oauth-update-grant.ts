import type { GuestOAuthGrant } from './guest-oauth';
import { GuestOAuthGrantConflict } from './guest-oauth-cart-lifetime';
import type { OAuthRecordStore } from './guest-oauth-records';

/** Preserve no-op revisions; changed grants require the current revision. */
export async function updateGuestGrant(
  store: OAuthRecordStore,
  { row, grant }: { row: { revision: number }; grant: GuestOAuthGrant },
  update: (grant: GuestOAuthGrant) => GuestOAuthGrant,
) {
  const next = update(grant);
  if (next === grant) return next;
  if (!(await store.compareAndSwap(`grant:${grant.id}`, row.revision, next, next.expiresAt)))
    throw new GuestOAuthGrantConflict();
  return next;
}
