import type { ExperienceCapability } from '@baci/shared/experience';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExperienceContext } from './authorization';
/** Bound to one authenticated request. No global client and no arbitrary table/URL input. */
export function createExperienceRepository(ctx: ExperienceContext) {
  const client = ctx.supabase as SupabaseClient;
  return {
    async readOwnedSource(
      artifactId: string
    ): Promise<Array<{ path: string; content: string }>> {
      const { data, error } = await client
        .from('experience_source_files')
        .select('path,content')
        .eq('merchant_id', ctx.merchantId)
        .eq('artifact_id', artifactId)
        .limit(128);
      if (error || !data) throw Error('NOT_FOUND');
      return data;
    },
    async loadOwnedJob(jobId: string) {
      const { data, error } = await client
        .from('experience_jobs')
        .select('id,artifact_id,source_digest,attempt_nonce,status,expires_at')
        .eq('merchant_id', ctx.merchantId)
        .eq('id', jobId)
        .maybeSingle();
      if (error || !data) throw Error('NOT_FOUND');
      return data as {
        id: string;
        artifact_id: string;
        source_digest: string;
        attempt_nonce: string;
        status: string;
        expires_at: string;
      };
    },
    readEffectiveCapabilities(
      requested: ExperienceCapability[],
      platform: ReadonlySet<ExperienceCapability>,
      features: ReadonlySet<ExperienceCapability>
    ) {
      return requested.filter((c) => platform.has(c) && features.has(c));
    },
  };
}
