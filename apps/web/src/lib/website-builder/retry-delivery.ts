import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createPortablePublishedSnapshot } from '@/lib/portable-published-snapshot';
import {
  deliveryClaimSchema,
  type PublicationProof,
} from '@/schemas/builder-publication';
import { portableHomeSchema } from '@/schemas/portable-storefront';
import { publicationResult, publicationRpc } from './publication-rpc';
export interface PublicationDeliveryDependencies {
  evict: (merchantId: string, canonicalUrl: string) => Promise<void>;
  probe: (input: {
    merchantId: string;
    url: string;
    publishedVersion: string;
    contentDigest: string;
    config: unknown;
  }) => Promise<boolean>;
  certifyDelivery: (proof: PublicationProof) => Promise<string>;
}
/** Owner recovery works after ChatGPT revocation; it only delivers a prior commit. */
export async function retryCommittedDelivery(
  ownerClient: SupabaseClient,
  receiptId: string,
  deps: PublicationDeliveryDependencies,
  explicitOwnerRetry = false
) {
  const claim = deliveryClaimSchema.parse(
    await publicationRpc(
      ownerClient,
      explicitOwnerRetry
        ? 'builder_retry_publication_delivery'
        : 'builder_claim_publication_delivery',
      { p_receipt: receiptId }
    )
  );
  if (!claim.leaseId || claim.result.status !== 'verifying')
    return claim.result;
  let proof: string | null = null;
  try {
    if (!claim.intentId || !claim.destinationUrl || !claim.effectDigest)
      throw Error('Incomplete delivery binding');
    const config = portableHomeSchema.parse(claim.config);
    const snapshot = await createPortablePublishedSnapshot(config);
    await deps.evict(claim.result.storefrontId, claim.destinationUrl);
    if (
      await deps.probe({
        merchantId: claim.result.storefrontId,
        url: claim.destinationUrl,
        publishedVersion: claim.result.publishedVersion,
        contentDigest: snapshot.publishedVersion,
        config,
      })
    )
      proof = await deps.certifyDelivery({
        intentId: claim.intentId,
        receiptId,
        kind: 'delivery',
        version: claim.result.publishedVersion,
        effectDigest: claim.effectDigest,
      });
  } catch {
    /* Uncertain delivery remains verifying; it is never republished or undone. */
  }
  return publicationResult(
    await publicationRpc(ownerClient, 'builder_finish_publication_delivery', {
      p_receipt: receiptId,
      p_lease: claim.leaseId,
      p_check: proof,
    })
  );
}
/** No service-role/global drain. The caller supplies this owner's renewed RLS client. */
export async function runOwnerPublicationOutbox(
  ownerClient: SupabaseClient,
  deps: PublicationDeliveryDependencies
) {
  const ids = z
    .array(z.uuid())
    .max(20)
    .parse(await publicationRpc(ownerClient, 'builder_due_publications'));
  const results = [];
  for (const id of ids)
    results.push(await retryCommittedDelivery(ownerClient, id, deps));
  return results;
}
