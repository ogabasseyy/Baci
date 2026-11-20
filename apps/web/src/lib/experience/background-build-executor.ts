import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { BuilderIdentity } from '@/lib/builder-connector/types';
import type { OwnerRequestContext } from './authorization';

const uuid = z.uuid();
const inputSchema = z.strictObject({
  connectionId: uuid,
  actorUserId: uuid,
  grantVersion: z.number().int().positive().safe(),
  merchantId: uuid,
  jobId: uuid,
});
const connectionSchema = z.object({
  connectionId: uuid,
  actorUserId: uuid,
  grantVersion: z.number().int().positive().safe(),
  status: z.literal('active'),
  revokedAt: z.null(),
  expiresAt: z.string(),
  scopes: z.array(
    z.enum(['storefront.read', 'storefront.write', 'storefront.publish'])
  ),
  allowedMerchantIds: z.array(uuid).max(1),
  allowCreateStore: z.boolean(),
});

/** Explicit executor only; no polling, process startup or privileged DB client. */
export function createBackgroundBuildExecutor(deps: {
  readConnection(id: string): Promise<unknown>;
  resolveUserClient(identity: BuilderIdentity): Promise<SupabaseClient>;
  finalizeBuild(
    ctx: OwnerRequestContext,
    input: { jobId: string; idempotencyKey: string }
  ): Promise<{ buildId: string; buildDigest: string }>;
}) {
  return async (input: z.infer<typeof inputSchema>) => {
    const v = inputSchema.parse(input);
    const parsed = connectionSchema.parse(
      await deps.readConnection(v.connectionId)
    );
    const expiresAt = Date.parse(parsed.expiresAt);
    if (
      parsed.connectionId !== v.connectionId ||
      parsed.actorUserId !== v.actorUserId ||
      parsed.grantVersion !== v.grantVersion ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now() ||
      !parsed.scopes.includes('storefront.write') ||
      !parsed.allowedMerchantIds.includes(v.merchantId)
    )
      throw Error('CONNECTION_REVOKED');
    const identity: BuilderIdentity = {
      connectionId: parsed.connectionId,
      actorUserId: parsed.actorUserId,
      grantVersion: parsed.grantVersion,
      scopes: new Set(parsed.scopes),
      allowedMerchantIds: parsed.allowedMerchantIds,
      allowCreateStore: parsed.allowCreateStore,
    };
    const supabase = await deps.resolveUserClient(identity);
    const preparation = await supabase.rpc(
      'experience_prepare_background_build',
      {
        p_merchant: v.merchantId,
        p_connection: v.connectionId,
        p_version: v.grantVersion,
        p_job: v.jobId,
      }
    );
    if (preparation.error || preparation.data !== 'ready')
      throw Error('BUILD_UNAVAILABLE');
    return deps.finalizeBuild(
      { identity, merchantId: v.merchantId, supabase },
      { jobId: v.jobId, idempotencyKey: v.jobId }
    );
  };
}
