import type { BuilderContext } from '@/lib/builder-connector/types';
import { requireBuilderScope } from './mutation-authorization';
import { publicationResult, publicationRpc } from './publication-rpc';
/** Read current state only. Delivery work is never hidden in status getters. */
export async function reconcileStorefrontPublication(
  ctx: BuilderContext,
  receiptId: string
) {
  requireBuilderScope(ctx.identity, 'storefront.read');
  return publicationResult(
    await publicationRpc(ctx.supabase, 'builder_get_publication_receipt', {
      p_receipt: receiptId,
      p_connection: ctx.identity.connectionId,
      p_version: ctx.identity.grantVersion,
    })
  );
}
