import { sourceDigest } from '@baci/shared/experience';
import { experienceFinalizedBuildRow } from '@/schemas/experience-job';
import { parseExperienceManifest } from '@/schemas/experience-manifest';
import { runLocalQualification } from '../../../tools/experience-runner/local-oci-executor';
import {
  type LocalPrerenderArtifacts,
  unpackPrerenderBuild,
} from '../../../tools/experience-runner/prerender-artifacts';
import { packPrivateBuild } from '../../../tools/experience-runner/private-build-payload';
import {
  type ExperienceContext,
  requireExperienceOwner,
} from './authorization';
import { createExperienceRepository } from './repository';

interface RecoveryJob {
  id: string;
  artifact_id: string;
  source_digest: string;
  attempt_nonce: string;
  expires_at: string;
}
const pending = new Map<string, Promise<void>>();
/** Retry only the missing companion, never the committed build or publication.
 * Existing output must match two fresh independent compilations exactly. */
export async function recoverFinalizedBuild(
  ctx: ExperienceContext,
  job: RecoveryJob,
  deps: {
    hostOrigin: string;
    previewOrigin?: string;
    profile?: 'production';
    artifacts?: LocalPrerenderArtifacts;
    execute?: typeof runLocalQualification;
  }
) {
  if (deps.profile === 'production' && (!deps.execute || !deps.artifacts))
    throw Error('INCOMPLETE_PRODUCTION_BUILD');
  await requireExperienceOwner(ctx);
  const found = await ctx.supabase
    .from('experience_builds')
    .select('id,build_digest,host_origin')
    .eq('merchant_id', ctx.merchantId)
    .eq('job_id', job.id)
    .maybeSingle();
  const parsed = experienceFinalizedBuildRow.safeParse(found.data);
  if (
    found.error ||
    !parsed.success ||
    parsed.data.host_origin !== deps.hostOrigin
  )
    throw Error('BUILD_FAILED');
  const build = parsed.data;
  const binding = {
    merchantId: ctx.merchantId,
    buildId: build.id,
    buildDigest: build.build_digest,
    sourceDigest: job.source_digest,
  };
  const artifacts = deps.artifacts;
  if (artifacts) {
    let missing = false;
    try {
      artifacts.read(binding);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'OUTPUT_NOT_RETAINED')
        throw error;
      missing = true;
    }
    if (missing) {
      if (
        !Number.isFinite(Date.parse(job.expires_at)) ||
        Date.parse(job.expires_at) <= Date.now()
      )
        throw Error('BUILD_FAILED');
      const key = JSON.stringify([
        ctx.merchantId,
        job.id,
        job.attempt_nonce,
        ctx.actorUserId,
        ctx.identity?.connectionId,
        ctx.identity?.grantVersion,
        binding.buildDigest,
      ]);
      let recovery = pending.get(key);
      if (!recovery) {
        if (pending.size >= 2) throw Error('QUOTA_EXCEEDED');
        recovery = (async () => {
          const source = await ctx.supabase
            .from('experience_artifacts')
            .select('manifest')
            .eq('merchant_id', ctx.merchantId)
            .eq('id', job.artifact_id)
            .maybeSingle();
          if (source.error || !source.data) throw Error('NOT_FOUND');
          const manifest = parseExperienceManifest(source.data.manifest);
          if (sourceDigest(manifest) !== job.source_digest)
            throw Error('BUILD_FAILED');
          await requireExperienceOwner(ctx);
          const execute = deps.execute ?? runLocalQualification;
          const payload = packPrivateBuild(
            manifest,
            deps.hostOrigin,
            deps.profile,
            deps.previewOrigin
          );
          const first = unpackPrerenderBuild(
            (await execute('prerender-build', payload)).output
          );
          await requireExperienceOwner(ctx);
          const second = unpackPrerenderBuild(
            (await execute('prerender-build', payload)).output
          );
          if (
            first.client.digest !== binding.buildDigest ||
            second.client.digest !== binding.buildDigest ||
            first.client.hostOrigin !== deps.hostOrigin ||
            second.client.hostOrigin !== deps.hostOrigin ||
            first.renderer.digest !== second.renderer.digest
          )
            throw Error('BUILD_FAILED');
          await requireExperienceOwner(ctx);
          const current = await createExperienceRepository(ctx).loadOwnedJob(
            job.id
          );
          if (
            current.status !== 'finalized' ||
            current.attempt_nonce !== job.attempt_nonce ||
            current.source_digest !== job.source_digest
          )
            throw Error('BUILD_FAILED');
          artifacts.retain({ ...binding, renderer: first.renderer });
        })();
        pending.set(key, recovery);
        const clear = () => {
          if (pending.get(key) === recovery) pending.delete(key);
        };
        void recovery.then(clear, clear);
      }
      await recovery;
    }
  }
  await requireExperienceOwner(ctx);
  return {
    buildId: binding.buildId,
    buildDigest: binding.buildDigest,
    proofs: [],
    performance: {
      status: 'not-measured' as const,
      cwvQualified: false as const,
      releaseQualified: false as const,
    },
  };
}
