import { join } from 'node:path';
import type {
  ExperienceManifest,
  PublicBootstrap,
} from '@baci/shared/experience';
import { sourceDigest } from '@baci/shared/experience';
import { experiencePerformanceReport } from '@/schemas/experience-performance';
import { createDurablePrerenderArtifacts } from '../../../tools/experience-runner/durable-prerender-artifacts';
import { runLocalQualification } from '../../../tools/experience-runner/local-oci-executor';
import { createLocalPrerenderArtifacts } from '../../../tools/experience-runner/prerender-artifacts';
import {
  type OwnerRequestContext,
  requireExperienceOwner,
} from './authorization';
import { measureCandidatePerformance } from './candidate-performance-measurement';
import { experienceBootstrapFingerprint } from './experience-bootstrap-fingerprint';
import { runExperienceBuild } from './local-build-supervisor';
import {
  createLocalExperienceRuntime,
  createProductionExperienceRuntime,
} from './local-owner-runtime';
import { createLocalPerformanceReports } from './local-performance-reports';
import { validatePerformanceBootstrap } from './performance-bootstrap';
import type { PreviewVault } from './preview-service';
import { productionDeliveryOrigins } from './production-origins';
/** Explicit local composition: the build and owner preview share exact companion output. */
export interface PrerenderPipelineSettings {
  artifactDirectory?: string;
  canonicalBase: string;
  vault: PreviewVault;
  build: Omit<
    Parameters<typeof runExperienceBuild>[2],
    'bootstrap' | 'prerenderArtifacts'
  >;
  bootstrap(
    ctx: OwnerRequestContext,
    manifest: ExperienceManifest,
    routeId: string
  ): Promise<PublicBootstrap>;
}
export function createLocalPrerenderPipeline(
  settings: PrerenderPipelineSettings
) {
  return createPrerenderPipeline(settings, 'local-synthetic');
}
export function createProductionPrerenderPipeline(
  settings: PrerenderPipelineSettings & {
    artifactDirectory: string;
    executionOrigin: string;
    build: PrerenderPipelineSettings['build'] & {
      execute: NonNullable<PrerenderPipelineSettings['build']['execute']>;
    };
  }
) {
  productionDeliveryOrigins({
    executionOrigin: settings.executionOrigin,
    hostOrigins: [new URL(settings.canonicalBase).origin],
  });
  if (
    !settings.artifactDirectory ||
    !settings.build.execute ||
    settings.vault.origin !== settings.executionOrigin
  )
    throw Error('INCOMPLETE_PRODUCTION_PIPELINE');
  return createPrerenderPipeline(
    settings,
    'production',
    settings.executionOrigin
  );
}
function createPrerenderPipeline(
  settings: PrerenderPipelineSettings,
  profile: 'local-synthetic' | 'production',
  executionOrigin?: string
) {
  if (profile === 'local-synthetic' && process.env.NODE_ENV === 'production')
    throw Error('PROFILE_DISABLED');
  const canonical = new URL(settings.canonicalBase);
  if (
    canonical.username ||
    canonical.password ||
    canonical.search ||
    canonical.hash ||
    canonical.origin !== settings.build.hostOrigin
  )
    throw Error('LOCAL_ORIGIN_REQUIRED');
  const artifacts = settings.artifactDirectory
    ? createDurablePrerenderArtifacts(settings.artifactDirectory)
    : createLocalPrerenderArtifacts();
  const performanceReports = createLocalPerformanceReports(
    settings.build.key,
    settings.artifactDirectory
      ? join(settings.artifactDirectory, 'performance')
      : undefined
  );
  const prerender = {
    artifacts,
    bootstrap: settings.bootstrap,
    execute: settings.build.execute,
    previewOrigin: settings.build.previewOrigin,
  };
  const execute = settings.build.execute;
  let owner: ReturnType<typeof createLocalExperienceRuntime>;
  if (profile === 'production') {
    if (!execute || !executionOrigin)
      throw Error('INCOMPLETE_PRODUCTION_PIPELINE');
    owner = createProductionExperienceRuntime(
      settings.vault,
      settings.canonicalBase,
      { ...prerender, executionOrigin, execute }
    );
  } else {
    owner = createLocalExperienceRuntime(
      settings.vault,
      settings.canonicalBase,
      prerender
    );
  }
  return {
    rendering: 'prerender-private' as const,
    finalizeBuild: (
      ctx: OwnerRequestContext,
      input: { jobId: string; idempotencyKey: string }
    ) =>
      runExperienceBuild(ctx, input, {
        ...settings.build,
        ...(profile === 'production' ? { profile: 'production' as const } : {}),
        prerenderArtifacts: artifacts,
        bootstrap: (owner, manifest) =>
          settings.bootstrap(owner, manifest, manifest.routes[0].view),
        performanceMeasurement: ({
          ctx: owner,
          manifest,
          candidate,
          renderer,
          rendererKind,
          assets,
          sourceDigest,
        }) =>
          measureCandidatePerformance({
            execute: settings.build.execute ?? runLocalQualification,
            manifest,
            bootstrap: async (view) => {
              await requireExperienceOwner(owner);
              const result = await settings.bootstrap(owner, manifest, view);
              await requireExperienceOwner(owner);
              return result;
            },
            candidate: {
              ...candidate,
              hostOrigin: candidate.hostOrigin ?? settings.build.hostOrigin,
            },
            renderer: {
              ...renderer,
              hostOrigin: renderer.hostOrigin ?? settings.build.hostOrigin,
            },
            rendererKind,
            assets,
            sourceDigest,
          }),
        performanceReports,
      }),
    owner,
    async readPerformance(
      binding: {
        merchantId: string;
        buildId: string;
        buildDigest: string;
        sourceDigest: string;
      },
      trusted?: { ctx: OwnerRequestContext; manifest: ExperienceManifest }
    ) {
      let report: ReturnType<typeof experiencePerformanceReport.parse>;
      try {
        const stored = performanceReports.read(binding);
        if (!stored) return undefined;
        report = experiencePerformanceReport.parse(stored);
      } catch {
        return undefined;
      }
      if (!trusted || !report.bootstrapDigests) return undefined;
      if (
        trusted.ctx.merchantId !== binding.merchantId ||
        sourceDigest(trusted.manifest) !== binding.sourceDigest
      )
        return undefined;
      const bootstrapDigests = report.bootstrapDigests;
      if (!bootstrapDigests) return undefined;
      const views = [
        ...new Set(trusted.manifest.routes.map((route) => route.view)),
      ];
      if (bootstrapDigests.length !== views.length) return undefined;
      try {
        for (const view of views) {
          const fresh = await validatePerformanceBootstrap(
            await settings.bootstrap(trusted.ctx, trusted.manifest, view),
            trusted.manifest,
            view
          );
          const route = fresh.route.canonicalPath;
          const expected = bootstrapDigests.find(
            (entry) => entry.route === route
          );
          if (
            !route ||
            fresh.route.canonicalPath !== route ||
            !expected ||
            experienceBootstrapFingerprint(fresh) !== expected.digest
          )
            return undefined;
        }
        return report;
      } catch {
        return undefined;
      }
    },
  };
}
