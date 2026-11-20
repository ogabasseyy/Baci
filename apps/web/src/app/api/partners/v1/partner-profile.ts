import type { projectCatalog } from './catalog/project-catalog';
import {
  authorizePartner,
  type PartnerConnection,
  type PartnerScope,
} from './partner-connection';

type QuoteListing = Pick<
  ReturnType<typeof projectCatalog>[number],
  | 'listing_id'
  | 'product_id'
  | 'variant_id'
  | 'offer_id'
  | 'title'
  | 'condition'
  | 'availability'
  | 'price_minor'
  | 'base_price_minor'
>;

export type PartnerProfile = {
  id: string;
  merchantId: string;
  credentials: readonly Pick<PartnerConnection, 'scopes' | 'token'>[];
  loadCatalog: () => Promise<{
    listings: readonly QuoteListing[];
    stockByListing: ReadonlyMap<string, number>;
  }>;
  readCatalogSnapshot: (
    validator: string | null
  ) => Promise<{ body: string | null; etag: string }>;
  catalogFailure?: { message: string; event: string };
  delivery: {
    carrier: 'GIGL';
    validityMs: number;
    settlementBasis: 'base_plus_delivery' | null;
  };
};

export function authorizePartnerProfile(
  authorization: string | null,
  scope: PartnerScope,
  profiles: readonly PartnerProfile[]
) {
  const grants = profiles.flatMap(({ id, merchantId, credentials }) =>
    credentials.map((credential) => ({ ...credential, id, merchantId }))
  );
  const access = authorizePartner(authorization, grants, scope);
  if (!access.ok) return access;

  const profilesForGrant = profiles.filter(
    (profile) => profile.id === access.connectionId
  );
  const [profile] = profilesForGrant;
  if (!profile || profilesForGrant.length !== 1) {
    return { ok: false, reason: 'ambiguous' } as const;
  }
  return { ...access, profile };
}
