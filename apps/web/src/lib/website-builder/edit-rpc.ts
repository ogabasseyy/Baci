import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { builderError } from '@/lib/builder-connector/errors';
import type { BuilderContext } from '@/lib/builder-connector/types';
import { builderRevisionSchema } from '@/schemas/builder-mcp-primitives';
import { builderFailureSchema } from '@/schemas/builder-mcp-results';
import {
  DraftServiceError,
  requireBuilderScope,
  safeDatabaseFailure,
} from './mutation-authorization';
export function editBinding(
  ctx: BuilderContext,
  scope: 'storefront.read' | 'storefront.write' = 'storefront.write'
) {
  requireBuilderScope(ctx.identity, scope);
  return {
    p_connection: ctx.identity.connectionId,
    p_version: ctx.identity.grantVersion,
    p_merchant: ctx.merchantId,
  };
}
export async function editRpc(
  ctx: BuilderContext,
  name: string,
  args: Record<string, unknown>
) {
  const { data, error } = await (ctx.supabase as SupabaseClient).rpc(
    name,
    args
  );
  if (error) safeDatabaseFailure(error);
  return data as unknown;
}
export function editResult<T extends z.ZodType>(schema: T, data: unknown) {
  const stale = z
    .object({
      status: z.literal('error'),
      code: z.literal('STALE_DRAFT'),
      currentVersion: builderRevisionSchema,
    })
    .strict()
    .safeParse(data);
  if (stale.success)
    return builderFailureSchema.parse(
      builderError('STALE_DRAFT', stale.data.currentVersion)
    );
  const failure = builderFailureSchema.safeParse(data);
  return failure.success ? failure.data : schema.parse(data);
}
export function checkStore(ctx: BuilderContext, storefrontId: string) {
  if (ctx.merchantId !== storefrontId) throw new DraftServiceError('NOT_FOUND');
}
