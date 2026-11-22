import type { SupabaseClient } from '@supabase/supabase-js';
import type { BuilderIdentity } from '@/lib/builder-connector/types';
import {
  type ExperienceBackgroundBuildInput,
  experienceBackgroundBuildConnection,
  experienceBackgroundBuildInput,
} from '@/schemas/experience-background-build';
import type { OwnerRequestContext } from './authorization';

/** Explicit executor only; no polling, process startup or privileged DB client. */
export function createBackgroundBuildExecutor(deps: {
  readConnection(id: string): Promise<unknown>;
  resolveUserClient(identity: BuilderIdentity): Promise<SupabaseClient>;
  finalizeBuild(
    ctx: OwnerRequestContext,
    input: { jobId: string; idempotencyKey: string }
  ): Promise<{ buildId: string; buildDigest: string }>;
}) {
  return async (input: ExperienceBackgroundBuildInput) => {
    const v = experienceBackgroundBuildInput.parse(input);
    const parsed = experienceBackgroundBuildConnection.parse(
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
