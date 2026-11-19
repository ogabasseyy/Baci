import type { ExperienceManifest } from '@baci/shared/experience';
import { parseExperienceManifest } from '@/schemas/experience-manifest';
import {
  type ExperiencePerformanceReport,
  experiencePerformanceReport,
} from '@/schemas/experience-performance';
import {
  type OwnerRequestContext,
  requireExperienceOwner,
} from './authorization';
import {
  assertCandidatePerformanceQualification,
  CandidatePerformanceQualificationError,
  type CandidatePerformanceQualificationReason,
  EXPERIENCE_PERFORMANCE_QUALIFICATION_POLICY,
} from './candidate-performance-qualification';
import { resolveExperienceRoute } from './route-resolver';

export interface PerformanceBinding {
  merchantId: string;
  buildId: string;
  buildDigest: string;
  sourceDigest: string;
}
/** Trusted local composition supplies retained results, never a caller URL/report. */
export type PerformanceReader = (
  binding: PerformanceBinding,
  context?: { ctx: OwnerRequestContext; manifest: ExperienceManifest }
) => Promise<unknown>;

export type PerformanceQualificationSummary =
  | {
      status: 'passed';
      policyId: typeof EXPERIENCE_PERFORMANCE_QUALIFICATION_POLICY.id;
      buildDigest: string;
      sourceDigest: string;
      reportDigest: string;
      routeCount: number;
      sampleCount: number;
      cwvQualified: false;
      releaseQualified: false;
    }
  | {
      status: 'failed';
      policyId: typeof EXPERIENCE_PERFORMANCE_QUALIFICATION_POLICY.id;
      reason: CandidatePerformanceQualificationReason;
      cwvQualified: false;
      releaseQualified: false;
    }
  | {
      status: 'not-measured';
      policyId: typeof EXPERIENCE_PERFORMANCE_QUALIFICATION_POLICY.id;
      cwvQualified: false;
      releaseQualified: false;
    };

async function representativeRoutes(
  input: unknown,
  samples: ExperiencePerformanceReport['samples']
) {
  const manifest = parseExperienceManifest(input);
  const expectedViews = new Set(manifest.routes.map((route) => route.view));
  const routes = [...new Set(samples.map((sample) => sample.route))];
  if (!expectedViews.size || routes.length !== expectedViews.size)
    throw new CandidatePerformanceQualificationError('route-matrix-mismatch');

  const representedViews = new Set<string>();
  for (const route of routes) {
    // Classification of trusted retained samples only. The pipeline reader separately
    // validates canonical identity and fingerprints against fresh catalog bootstraps.
    const result = await resolveExperienceRoute(manifest.routes, route, {
      product: async (handle) => ({ id: handle, canonicalPath: route }),
      collection: async (handle) => ({ id: handle }),
    });
    const resolved = result.kind === 'route' ? result.route : null;
    if (
      !resolved ||
      resolved.canonicalPath !== route ||
      !expectedViews.has(resolved.view) ||
      representedViews.has(resolved.view)
    )
      throw new CandidatePerformanceQualificationError('route-matrix-mismatch');
    representedViews.add(resolved.view);
  }
  if (representedViews.size !== expectedViews.size)
    throw new CandidatePerformanceQualificationError('route-matrix-mismatch');
  return routes;
}

function failedQualification(reason: CandidatePerformanceQualificationReason) {
  return {
    status: 'failed' as const,
    policyId: EXPERIENCE_PERFORMANCE_QUALIFICATION_POLICY.id,
    reason,
    cwvQualified: false as const,
    releaseQualified: false as const,
  };
}

function summarizeQualification(
  qualification: ReturnType<typeof assertCandidatePerformanceQualification>
): PerformanceQualificationSummary {
  const { report: _report, ...summary } = qualification;
  return { status: 'passed', ...summary };
}

export async function readExperiencePerformance(
  inputCtx: OwnerRequestContext,
  buildId: string,
  read?: PerformanceReader,
  scope:
    | 'storefront.read'
    | 'storefront.write'
    | 'storefront.publish' = 'storefront.read'
) {
  const ctx = await requireExperienceOwner(inputCtx, scope);
  const build = await ctx.supabase
    .from('experience_builds')
    .select('build_digest,job_id')
    .eq('merchant_id', ctx.merchantId)
    .eq('id', buildId)
    .maybeSingle();
  if (build.error || !build.data) throw Error('NOT_FOUND');
  const job = await ctx.supabase
    .from('experience_jobs')
    .select('source_digest,artifact_id')
    .eq('merchant_id', ctx.merchantId)
    .eq('id', build.data.job_id)
    .maybeSingle();
  if (job.error || !job.data) throw Error('NOT_FOUND');
  const binding = {
    merchantId: ctx.merchantId,
    buildId,
    buildDigest: build.data.build_digest as string,
    sourceDigest: job.data.source_digest as string,
  };
  let manifest: ExperienceManifest | undefined;
  if (read) {
    const artifact = await ctx.supabase
      .from('experience_artifacts')
      .select('manifest')
      .eq('merchant_id', ctx.merchantId)
      .eq('id', job.data.artifact_id)
      .maybeSingle();
    if (artifact.error || !artifact.data) throw Error('NOT_FOUND');
    manifest = parseExperienceManifest(artifact.data.manifest);
    await requireExperienceOwner(ctx, scope);
  }
  const raw = read
    ? await read(binding, manifest ? { ctx, manifest } : undefined)
    : undefined;
  if (raw === undefined || raw === null) {
    await requireExperienceOwner(ctx, scope);
    return {
      buildId,
      buildDigest: binding.buildDigest,
      status: 'not-measured' as const,
      cwvQualified: false as const,
      releaseQualified: false as const,
      qualification: {
        status: 'not-measured' as const,
        policyId: EXPERIENCE_PERFORMANCE_QUALIFICATION_POLICY.id,
        cwvQualified: false as const,
        releaseQualified: false as const,
      },
    };
  }
  const report = experiencePerformanceReport.safeParse(raw);
  if (
    !report.success ||
    report.data.buildDigest !== binding.buildDigest ||
    report.data.sourceDigest !== binding.sourceDigest
  )
    throw Error('STALE_SOURCE');

  await requireExperienceOwner(ctx, scope);

  let qualification: PerformanceQualificationSummary;
  try {
    const routes = [
      ...new Set(report.data.samples.map((sample) => sample.route)),
    ];
    const checked = assertCandidatePerformanceQualification(report.data, {
      buildDigest: binding.buildDigest,
      sourceDigest: binding.sourceDigest,
      renderer: report.data.renderer,
      routes,
      bootstrapDigests: report.data.bootstrapDigests ?? [],
    });
    const representatives = await representativeRoutes(
      manifest,
      report.data.samples
    );
    if (
      routes.length !== representatives.length ||
      routes.some((route) => !representatives.includes(route))
    )
      throw new CandidatePerformanceQualificationError('route-matrix-mismatch');
    qualification = summarizeQualification(checked);
  } catch (error) {
    qualification = failedQualification(
      error instanceof CandidatePerformanceQualificationError
        ? error.reason
        : 'route-matrix-mismatch'
    );
  }
  return {
    buildId,
    status: 'lab-only' as const,
    report: report.data,
    qualification,
  };
}
