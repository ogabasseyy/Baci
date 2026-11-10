import type { ExperienceManifest } from '@baci/shared/experience';
import { sourceDigest } from '@baci/shared/experience';
import { parseExperienceManifest } from '@/schemas/experience-manifest';
import { runLocalQualification } from '../../../tools/experience-runner/local-oci-executor';
import {
  acceptJobOutput,
  signJobTicket,
} from '../../../tools/experience-runner/output-receiver';
import { unpackPrerenderBuild } from '../../../tools/experience-runner/prerender-artifacts';
import { localPreviewHost } from '../../../tools/experience-runner/preview-origin';
import { packPrivateBuild } from '../../../tools/experience-runner/private-build-payload';
import { loadOfflineAssets } from './asset-service';
import {
  type OwnerRequestContext,
  ownerRpcArgs,
  requireExperienceOwner,
} from './authorization';
import { retainBuildPerformanceReport } from './build-performance-retention';
import { verifyCompiledCandidate } from './build-service';
import { assertCandidatePerformanceBudget } from './candidate-performance-budget';
import { finalizeExperienceBuild } from './finalize-build';
import type { ExperienceBuildDependencies } from './local-build-supervisor-types';
import { digestBytes } from './manifest-digest';
import { productionOrigin } from './production-origins';
import { qualifyBuildRender } from './qualify-build-render';
import { recoverFinalizedBuild } from './recover-finalized-build';
import { createExperienceRepository } from './repository';

export type { VerifierReceipt } from './local-build-supervisor-types';
export async function runExperienceBuild(
  inputCtx: OwnerRequestContext,
  input: { jobId: string; idempotencyKey: string },
  deps: ExperienceBuildDependencies
) {
  if (deps.previewOrigin && deps.profile !== 'production')
    throw Error('INVALID_PREVIEW_ORIGIN');
  if (
    deps.profile === 'production' &&
    (!deps.execute ||
      !deps.prerenderArtifacts ||
      typeof deps.bootstrap !== 'function')
  )
    throw Error('INCOMPLETE_PRODUCTION_BUILD');
  const hostOrigin =
    deps.profile === 'production'
      ? productionOrigin(deps.hostOrigin)
      : localPreviewHost(deps.hostOrigin);
  const ctx = await requireExperienceOwner(inputCtx);
  const repo = createExperienceRepository(ctx);
  const job = await repo.loadOwnedJob(input.jobId);
  if (job.status === 'finalized')
    return recoverFinalizedBuild(ctx, job, {
      hostOrigin,
      previewOrigin: deps.previewOrigin,
      profile: deps.profile,
      artifacts: deps.prerenderArtifacts,
      execute: deps.execute,
    });
  if (job.status !== 'queued' || Date.parse(job.expires_at) <= Date.now())
    throw Error('BUILD_FAILED');
  const claim = await ctx.supabase.rpc('experience_claim_build', {
    ...ownerRpcArgs(ctx),
    p_job: job.id,
    p_attempt: job.attempt_nonce,
  });
  if (claim.error) throw Error('BUILD_FAILED');
  let transientId: string | undefined;
  try {
    const source = await ctx.supabase
      .from('experience_artifacts')
      .select('manifest')
      .eq('merchant_id', ctx.merchantId)
      .eq('id', job.artifact_id)
      .maybeSingle();
    if (source.error || !source.data) throw Error('NOT_FOUND');
    const manifest: ExperienceManifest = parseExperienceManifest(
      source.data.manifest
    );
    if (sourceDigest(manifest) !== job.source_digest)
      throw Error('BUILD_FAILED');
    const bootstrap =
      typeof deps.bootstrap === 'function'
        ? await deps.bootstrap(ctx, manifest)
        : deps.bootstrap;
    await requireExperienceOwner(ctx);
    const execute = deps.execute ?? runLocalQualification;
    const ticket = signJobTicket(
      {
        jobId: job.id,
        sourceDigest: job.source_digest,
        attemptNonce: job.attempt_nonce,
        audience: 'experience-output',
        toolchainDigest: deps.toolchainDigest,
        expiresAt: Math.min(Date.parse(job.expires_at), Date.now() + 600000),
        maxBytes: 16777216,
      },
      deps.key
    );
    const first = await execute(
      deps.prerenderArtifacts ? 'prerender-build' : 'compile',
      packPrivateBuild(manifest, hostOrigin, deps.profile, deps.previewOrigin)
    );
    const prepared = deps.prerenderArtifacts
      ? unpackPrerenderBuild(first.output)
      : undefined;
    const candidate = prepared?.client ?? verifyCompiledCandidate(first.output);
    if (candidate.hostOrigin !== hostOrigin) throw Error('BUILD_FAILED');
    assertCandidatePerformanceBudget({
      javascript: candidate.javascript,
      css: candidate.css,
      assets: [],
    });
    const assets = manifest.assets.length
      ? await loadOfflineAssets(
          ctx,
          manifest.assets.map((a) => a.assetId)
        )
      : [];
    assertCandidatePerformanceBudget({
      javascript: '',
      css: '',
      assets,
    });
    const independent = await execute(
      deps.prerenderArtifacts ? 'prerender-build' : 'compile',
      packPrivateBuild(manifest, hostOrigin, deps.profile, deps.previewOrigin)
    );
    const repeated = prepared
      ? unpackPrerenderBuild(independent.output)
      : undefined;
    if (
      prepared &&
      (!repeated || repeated.renderer.digest !== prepared.renderer.digest)
    )
      throw Error('BUILD_FAILED');
    if (prepared) {
      const proof = await execute('prerender', {
        javascript: prepared.renderer.javascript,
        bootstrap,
      });
      const output = proof.output;
      if (
        !output ||
        typeof output !== 'object' ||
        !('format' in output) ||
        output.format !== 'baci-prerender/v1' ||
        !('html' in output) ||
        typeof output.html !== 'string'
      )
        throw Error('BUILD_FAILED');
      assertCandidatePerformanceBudget({
        javascript: '',
        css: '',
        ssrHtml: output.html,
        assets: [],
      });
    }
    const performance = deps.performanceMeasurement
      ? await deps.performanceMeasurement({
          ctx,
          manifest,
          candidate,
          renderer: prepared?.renderer ?? candidate,
          rendererKind: prepared ? 'prerender' : 'client',
          assets,
          sourceDigest: job.source_digest,
        })
      : { status: 'not-measured' as const, jobIds: [] };
    await requireExperienceOwner(ctx);
    const acceptedId = await acceptJobOutput(ticket, candidate, {
      key: deps.key,
      store: deps.transient,
      now: Date.now,
      currentAttempt: async () => {
        await requireExperienceOwner(ctx);
        return (await repo.loadOwnedJob(job.id)).attempt_nonce;
      },
    });
    transientId = acceptedId;
    const proofs = await qualifyBuildRender({
      execute,
      candidate,
      independentOutput: repeated?.client ?? independent.output,
      readCandidate: () => deps.transient.read(acceptedId, Date.now()),
      manifest,
      bootstrap,
      assets,
      hostOrigins: [
        ...new Set([
          hostOrigin,
          ...(deps.previewOrigin ? [productionOrigin(deps.previewOrigin)] : []),
        ]),
      ],
    });
    await requireExperienceOwner(ctx);
    const current = await repo.loadOwnedJob(job.id);
    if (
      current.attempt_nonce !== job.attempt_nonce ||
      current.status === 'cancelled'
    )
      throw Error('BUILD_FAILED');
    const receiptDigest = digestBytes(
      JSON.stringify({
        sourceDigest: job.source_digest,
        buildDigest: candidate.digest,
        toolchainDigest: deps.toolchainDigest,
        ...(prepared ? { rendererDigest: prepared.renderer.digest } : {}),
        performanceStatus: performance.status,
        performanceJobIds: performance.jobIds,
        ...(performance.report
          ? {
              performanceReportDigest: digestBytes(
                JSON.stringify(performance.report)
              ),
            }
          : {}),
        firstJob: first.jobId,
        independentJob: independent.jobId,
        proofs,
      })
    );
    await deps.recordVerifiedEvidence({
      merchantId: ctx.merchantId,
      jobId: job.id,
      attemptNonce: job.attempt_nonce,
      buildDigest: candidate.digest,
      receiptDigest,
      hostOrigin,
    });
    const result = await finalizeExperienceBuild(ctx, input, {
      jobId: job.id,
      attemptNonce: job.attempt_nonce,
      sourceDigest: job.source_digest,
      candidate,
      receiptDigest,
    });
    const performanceStatus = await retainBuildPerformanceReport(
      ctx,
      {
        merchantId: ctx.merchantId,
        buildId: result.buildId,
        buildDigest: candidate.digest,
        sourceDigest: job.source_digest,
      },
      performance,
      deps.performanceReports
    );
    if (prepared && deps.prerenderArtifacts) {
      await requireExperienceOwner(ctx);
      deps.prerenderArtifacts.retain({
        merchantId: ctx.merchantId,
        buildId: result.buildId,
        buildDigest: candidate.digest,
        sourceDigest: job.source_digest,
        renderer: prepared.renderer,
      });
    }
    return {
      ...result,
      proofs,
      performance: {
        status: performanceStatus,
        cwvQualified: false as const,
        releaseQualified: false as const,
      },
    };
  } catch (error) {
    await ctx.supabase.rpc('experience_fail_build', {
      ...ownerRpcArgs(ctx),
      p_job: job.id,
      p_attempt: job.attempt_nonce,
    });
    throw error;
  } finally {
    if (transientId) deps.transient.remove(transientId);
  }
}
