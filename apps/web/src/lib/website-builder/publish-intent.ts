import type {
  BuilderContext,
  PublishInput,
} from '@/lib/builder-connector/types';
import { builderInputSchemas } from '@/schemas/builder-mcp';
import { checkStore } from './edit-rpc';
import { requireBuilderScope } from './mutation-authorization';
import { previewStorefront } from './preview';
import { publicationResult, publicationRpc } from './publication-rpc';
/** Creates only a short-lived approval selector. No caller/model flag publishes. */
export async function requestStorefrontPublication(
  ctx: BuilderContext,
  input: PublishInput
) {
  requireBuilderScope(ctx.identity, 'storefront.publish');
  requireBuilderScope(ctx.identity, 'storefront.read');
  const parsed = builderInputSchemas.publish_storefront.parse(input);
  checkStore(ctx, parsed.storefrontId);
  const result = publicationResult(
    await publicationRpc(ctx.supabase, 'builder_request_publication', {
      p_connection: ctx.identity.connectionId,
      p_version: ctx.identity.grantVersion,
      p_merchant: ctx.merchantId,
      p_expected: parsed.expectedVersion,
      p_retry_key: parsed.idempotencyKey,
    })
  );
  if (result.status !== 'approval_required') return result; // committed replays precede freshness/expiry checks
  const preview = await previewStorefront(ctx, {
    storefrontId: ctx.merchantId,
    pageSlug: 'home',
    expectedVersion: result.version,
  });
  if ('status' in preview) return preview;
  if (!preview.readiness.ready)
    return {
      storefrontId: ctx.merchantId,
      version: result.version,
      status: 'blocked' as const,
      missingItems: preview.readiness.missingItems,
    };
  return result;
}
