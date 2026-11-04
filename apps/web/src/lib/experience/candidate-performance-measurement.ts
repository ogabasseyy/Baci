import { cpus, loadavg } from 'node:os';
import type {
  ExperienceManifest,
  PublicBootstrap,
} from '@baci/shared/experience';
import type { ExperiencePerformanceReport } from '@/schemas/experience-performance';
import {
  type performancePublicBootstrap,
  performanceWorkerOutput,
} from '@/schemas/experience-performance-worker';
import {
  performanceCss,
  performanceOrigins,
} from '../../../tools/experience-runner/performance-origins';
import { assertCandidatePerformanceBudget } from './candidate-performance-budget';
import type {
  CandidatePerformanceInput,
  LocalAsset,
} from './candidate-performance-measurement-types';
import {
  assertCandidatePerformanceQualification,
  EXPERIENCE_PERFORMANCE_QUALIFICATION_POLICY,
} from './candidate-performance-qualification';
import { experienceBootstrapFingerprint } from './experience-bootstrap-fingerprint';
import { digestBytes } from './manifest-digest';
import { validatePerformanceBootstrap } from './performance-bootstrap';
import { createPrivatePrerenderDocument } from './private-prerender-document';

const qualification = EXPERIENCE_PERFORMANCE_QUALIFICATION_POLICY;

export type {
  Candidate,
  CandidatePerformanceInput,
  Execute,
  LocalAsset,
} from './candidate-performance-measurement-types';

function hostIsContaminated() {
  return loadavg()[0] > cpus().length * 0.8;
}

function representativeViews(manifest: ExperienceManifest) {
  const views = [...new Set(manifest.routes.map((route) => route.view))];
  if (!views.length) throw Error('BUILD_FAILED');
  return views;
}

function mapAssets(
  bootstrap: PublicBootstrap,
  assets: LocalAsset[],
  digest: string,
  resourceOrigin: string
) {
  const base = `${resourceOrigin}/resource/${digest}/assets`;
  return {
    ...bootstrap,
    assets: Object.fromEntries(
      assets.map((asset) => [asset.assetId, `${base}/${asset.assetId}`])
    ),
  };
}

function routeAssets(assets: LocalAsset[]) {
  return assets.map((asset) => {
    const bytes = Buffer.from(asset.bytesBase64, 'base64');
    if (
      bytes.toString('base64') !== asset.bytesBase64 ||
      digestBytes(bytes) !== asset.digest
    )
      throw Error('BUILD_FAILED');
    return asset;
  });
}

/** Runs fixed trusted Chromium samples. Failures produce partial diagnostics and never fail a functional build. */
export async function measureCandidatePerformance(
  input: CandidatePerformanceInput
) {
  const routes: string[] = [];
  const bootstrapDigests: Array<{ route: string; digest: string }> = [];
  const samples: ExperiencePerformanceReport['samples'] = [];
  const jobIds: string[] = [];
  let browser = 'Chromium unavailable';
  let contaminated = false;
  const isHostContaminated = input.hostContaminated ?? hostIsContaminated;
  const bindings = {
    buildDigest: input.candidate.digest,
    sourceDigest: input.sourceDigest,
    renderer: input.rendererKind,
  };

  try {
    const { resourceOrigin, transport } = performanceOrigins(
      input.candidate.hostOrigin
    );
    const assets = routeAssets(input.assets);
    const deliveredCss = performanceCss(
      input.candidate.css,
      `${resourceOrigin}/resource/${input.candidate.digest}`,
      assets.map((asset) => asset.assetId)
    );
    for (const view of representativeViews(input.manifest)) {
      let cleanBootstrap: ReturnType<typeof performancePublicBootstrap.parse>;
      try {
        cleanBootstrap = await validatePerformanceBootstrap(
          await input.bootstrap(view),
          input.manifest,
          view
        );
      } catch (error) {
        if (
          error instanceof Error &&
          ['NOT_FOUND', 'INSUFFICIENT_SCOPE'].includes(error.message)
        )
          throw error;
        return {
          status: 'not-measured' as const,
          report: undefined,
          jobIds,
        };
      }
      routes.push(cleanBootstrap.route.canonicalPath);
      bootstrapDigests.push({
        route: cleanBootstrap.route.canonicalPath,
        digest: experienceBootstrapFingerprint(cleanBootstrap),
      });
      const bootstrap = mapAssets(
        cleanBootstrap,
        assets,
        input.candidate.digest,
        resourceOrigin
      );
      let html: string | undefined;
      if (input.rendererKind === 'prerender') {
        const rendered = await input.execute('prerender', {
          javascript: input.renderer.javascript,
          bootstrap,
        });
        jobIds.push(rendered.jobId);
        if (
          !rendered.output ||
          typeof rendered.output !== 'object' ||
          !('format' in rendered.output) ||
          rendered.output.format !== 'baci-prerender/v1' ||
          !('html' in rendered.output) ||
          typeof rendered.output.html !== 'string'
        )
          throw Error('INVALID_PERFORMANCE_SAMPLE');
        assertCandidatePerformanceBudget({
          javascript: '',
          css: '',
          ssrHtml: rendered.output.html,
          assets: [],
        });
        const resources = [
          {
            path: 'app.js',
            url: `${resourceOrigin}/resource/${input.candidate.digest}/app.js`,
            digest: digestBytes(Buffer.from(input.candidate.javascript)),
          },
          {
            path: 'app.css',
            url: `${resourceOrigin}/resource/${input.candidate.digest}/app.css`,
            digest: digestBytes(Buffer.from(deliveredCss)),
          },
          ...assets.map((asset) => ({
            path: `assets/${asset.assetId}`,
            url: `${resourceOrigin}/resource/${input.candidate.digest}/assets/${asset.assetId}`,
            digest: asset.digest,
          })),
        ];
        html = createPrivatePrerenderDocument(
          rendered.output.html,
          bootstrap,
          resources,
          {
            buildDigest: input.candidate.digest,
            ...(transport === 'https-loopback-tls'
              ? { executionOrigin: resourceOrigin }
              : {}),
          }
        );
      }

      for (const width of qualification.widths) {
        for (
          let sampleIndex = 0;
          sampleIndex < qualification.coldSamplesPerCell;
          sampleIndex++
        ) {
          if (isHostContaminated()) {
            contaminated = true;
            break;
          }
          const measured = await input.execute('performance', {
            mode: 'candidate-performance/v1',
            width,
            bundle: input.candidate,
            bootstrap,
            ...(html ? { html } : {}),
            assets,
          });
          jobIds.push(measured.jobId);
          const parsed = performanceWorkerOutput.parse(measured.output);
          if (
            transport === 'https-loopback-tls' &&
            (parsed.diagnostics.transport !== transport ||
              (parsed.diagnostics.tlsConnections ?? 0) < 2)
          )
            throw Error('INVALID_PERFORMANCE_SAMPLE');
          if (
            parsed.policyId !== qualification.id ||
            parsed.buildDigest !== input.candidate.digest ||
            parsed.width !== width ||
            parsed.route !== cleanBootstrap.route.canonicalPath
          )
            throw Error('INVALID_PERFORMANCE_SAMPLE');
          if (samples.length > 0 && browser !== parsed.browser)
            throw Error('INVALID_PERFORMANCE_SAMPLE');
          browser = parsed.browser;
          const hostContaminated = isHostContaminated();
          contaminated ||= parsed.contaminated || hostContaminated;
          samples.push({
            width,
            cache: 'cold-context',
            route: parsed.route,
            frameLcpMs: parsed.frameLcpMs,
            hostLcpMs: parsed.hostLcpMs,
            frameCls: parsed.frameCls,
            hostCls: parsed.hostCls,
            diagnostics: parsed.diagnostics,
            interactionDurationMs: parsed.interactionDurationMs,
            contentVisible: parsed.contentVisible,
            imagesDecoded: parsed.imagesDecoded,
            consoleErrors: parsed.consoleErrors,
          });
          if (contaminated) break;
        }
        if (contaminated) break;
      }
      if (contaminated) break;
    }
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'PERFORMANCE_BUDGET_EXCEEDED'
    )
      throw error;
    if (
      error instanceof Error &&
      ['NOT_FOUND', 'INSUFFICIENT_SCOPE'].includes(error.message)
    )
      throw error;
    contaminated = true;
  }

  if (!samples.length) {
    return {
      status: 'not-measured' as const,
      report: undefined,
      jobIds,
    };
  }
  const report: ExperiencePerformanceReport = {
    format: 'baci.performance-lab/v1',
    ...bindings,
    measuredAt: new Date().toISOString(),
    environment: 'local-synthetic',
    cwvQualified: false,
    releaseQualified: false,
    contaminated,
    browser,
    bootstrapDigests,
    samples,
  };
  try {
    return {
      status: 'measured' as const,
      report,
      jobIds,
      qualification: assertCandidatePerformanceQualification(report, {
        ...bindings,
        routes,
        bootstrapDigests,
      }),
    };
  } catch {
    return {
      status: 'failed' as const,
      report,
      jobIds,
    };
  }
}
