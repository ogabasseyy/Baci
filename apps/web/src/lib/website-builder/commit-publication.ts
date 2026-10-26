import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyBuilderPublishIntent } from '@/lib/builder-connector/approval';
import type { PublicationProof } from '@/schemas/builder-publication';
import { projectBoundPublication } from './load-publication';
import {
  DraftServiceError,
  requireBuilderScope,
} from './mutation-authorization';
import {
  publicationResult,
  publicationRpc,
  readStoredPublication,
} from './publication-rpc';
export interface PublicationRenderVerifier {
  certifyRender: (proof: PublicationProof, config: unknown) => Promise<string>;
}
/** Normal signed-in owner only. The model-facing registry exposes no confirm tool. */
export async function confirmStorefrontPublication(
  ownerClient: SupabaseClient,
  intentId: string,
  verifier: PublicationRenderVerifier
) {
  const record = await readStoredPublication(ownerClient, intentId);
  if ('receipt' in record)
    return publicationResult(
      await publicationRpc(ownerClient, 'builder_confirm_publication', {
        p_intent: intentId,
        p_render_check: null,
      })
    );
  const { preview, currentVersion, ctx } = await projectBoundPublication(
    ownerClient,
    record
  );
  requireBuilderScope(ctx.identity, 'storefront.publish');
  const verified = verifyBuilderPublishIntent(record.intent, {
    actorUserId: ctx.identity.actorUserId,
    connectionId: ctx.identity.connectionId,
    grantVersion: ctx.identity.grantVersion,
    storefrontId: ctx.merchantId,
    draftVersion: currentVersion,
    destinationUrl: `https://${preview.projection.identity.slug}.usebaci.com`,
    pageSlugs: ['home'],
    policyNamespace: 'baci.website-builder',
    policyVersion: 1,
    effectDigest: record.intent.effectDigest,
    nonceConsumed: false,
    approverAuthorized: true,
  });
  if (!verified.ok) throw new DraftServiceError(verified.code);
  const check = await verifier.certifyRender(
    {
      intentId,
      receiptId: null,
      kind: 'render',
      version: record.intent.draftVersion,
      effectDigest: record.intent.effectDigest,
    },
    record.config
  );
  return publicationResult(
    await publicationRpc(ownerClient, 'builder_confirm_publication', {
      p_intent: intentId,
      p_render_check: check,
    })
  );
}
