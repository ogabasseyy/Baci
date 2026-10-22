import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { builderError } from '@/lib/builder-connector/errors';
import type { BuilderContext } from '@/lib/builder-connector/types';
import { builderDraftResultSchema } from '@/schemas/builder-mcp-results';
import {
  type PortableHome,
  portableHomeSchema,
} from '@/schemas/portable-storefront';
import { parseDraftRetryKey } from './idempotency';
import {
  requireBuilderScope,
  safeDatabaseFailure,
} from './mutation-authorization';
import { parseDraftRevision } from './revision';
export interface ValidatedDraftMutation {
  expectedVersion: string;
  idempotencyKey: string;
  config: PortableHome;
}
/** Internal candidate commit. Natural-language tool inputs never accept arbitrary config. */
export async function commitDraft(
  ctx: BuilderContext,
  mutation: ValidatedDraftMutation
) {
  requireBuilderScope(ctx.identity, 'storefront.write');
  const expected = parseDraftRevision(mutation.expectedVersion);
  const config = portableHomeSchema.parse(mutation.config);
  const { data, error } = await (ctx.supabase as SupabaseClient).rpc(
    'builder_commit_draft',
    {
      p_connection: ctx.identity.connectionId,
      p_version: ctx.identity.grantVersion,
      p_merchant: ctx.merchantId,
      p_expected: expected.slice(6),
      p_retry_key: parseDraftRetryKey(mutation.idempotencyKey),
      p_config: config,
    }
  );
  if (error) safeDatabaseFailure(error);
  const stale = z
    .object({ code: z.literal('STALE_DRAFT'), currentVersion: z.string() })
    .safeParse(data);
  if (stale.success)
    return builderError(
      'STALE_DRAFT',
      parseDraftRevision(stale.data.currentVersion)
    );
  return builderDraftResultSchema.parse(data);
}
