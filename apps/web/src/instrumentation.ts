/**
 * Next.js Instrumentation — Per-Tenant OpenTelemetry
 *
 * Registers the Vercel OpenTelemetry SDK for distributed tracing.
 * All traces include the merchant/tenant context for multi-tenant observability.
 *
 * This file is automatically loaded by Next.js 16 at startup.
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

import { join } from 'node:path';
import type { Instrumentation } from 'next';
import { getNextErrorDigest } from '@/lib/errors/next-error-digest';

const reportedRateLimitBackends = new Set<string>();
const pendingRateLimitBackends = new Set<string>();

const QUERY_OR_HASH_PATTERN = /[?#]/;

function stripQueryAndHash(path: string): string {
  const markerIndex = path.search(QUERY_OR_HASH_PATTERN);
  return markerIndex === -1 ? path : path.slice(0, markerIndex);
}

function getHeaderValue(
  headers: NodeJS.Dict<string | string[]>,
  name: string
): string | undefined {
  const lookupName = name.toLowerCase();
  const value = Object.entries(headers).find(
    ([headerName]) => headerName.toLowerCase() === lookupName
  )?.[1];
  const firstValue = Array.isArray(value) ? value[0] : value;
  const normalizedValue = firstValue?.trim().toLowerCase();

  return normalizedValue || undefined;
}

function getRequestTenantContext(
  headers: NodeJS.Dict<string | string[]>
): Record<string, string> {
  const merchantSlug = getHeaderValue(headers, 'x-merchant-slug');
  const merchantDomain = getHeaderValue(headers, 'x-merchant-domain');
  const requestHost = getHeaderValue(headers, 'host');

  return {
    ...(merchantSlug ? { merchant_slug: merchantSlug } : {}),
    ...(merchantDomain ? { merchant_domain: merchantDomain } : {}),
    ...(requestHost ? { request_host: requestHost } : {}),
  };
}

export async function register() {
  // Only register in server-side environments (Node.js runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Standalone starts can reuse serialized Next config: recheck the actual
    // runtime public tree, including lab-built artifacts started with flag off.
    // The root resolves through the shared helper (config-stashed or
    // standalone-anchored) so boot inspects the same tree the build gate
    // did — never a silently wrong lookalike.
    const { assertPilotPublicAssets, resolvePilotPublicDir } = await import(
      '@/config/pilot-public-assets'
    );
    const { isPilotLabEnabled } = await import('@/config/pilot-lab-enabled');
    let pilotPublicDir: string;
    try {
      pilotPublicDir = resolvePilotPublicDir();
    } catch (error) {
      // Unanchored boot (no config stash, no standalone path): lab mode
      // demands a verified tree and stays fatal. With the lab off, an
      // unrelated boot must not brick — but a provably-wrong cwd must
      // not pass a lookalike either. The probe below returns the cwd
      // tree only when the cwd is plausibly the served app root
      // (public/ or next.config.* present); otherwise it refuses, since
      // the real tree is unseen and may hold staged content. Detected
      // staged content still refuses in the check below; the residual
      // (a custom server rooted elsewhere from an app-root cwd) warns.
      if (isPilotLabEnabled()) {
        throw error;
      }
      const { cwdPublicDirIfAppRoot } = await import(
        '@/config/pilot-public-assets-triage'
      );
      pilotPublicDir = cwdPublicDirIfAppRoot();
      console.warn(
        'merchant image pilot: startup gate cannot anchor the public tree (no config stash, no standalone path); checked cwd/public only — a custom server rooted elsewhere would be unseen'
      );
    }
    assertPilotPublicAssets(pilotPublicDir);
    if (isPilotLabEnabled()) {
      // Production-lab exposure banner: reaching here with
      // NODE_ENV=production means BACI_IMAGE_PILOT_ALLOW_PROD=1
      // explicitly opted this box into serving staged merchant bytes
      // as static files (no auth, predictable /__pilot/... URLs) from
      // a production build. Say so on every boot, so a copied env file
      // can never enable this silently.
      if (process.env.NODE_ENV === 'production') {
        console.warn(
          'merchant image pilot: LAB ENABLED IN PRODUCTION (BACI_IMAGE_PILOT_ALLOW_PROD=1) — staged merchant bytes are publicly served as static files under /__pilot with no authentication. Disable the flag and remove the staged tree when measurement ends.'
        );
      }
      const { initializeLabRuntime } = await import(
        '@/app/pilot-lab/lab-route'
      );
      // Fail-loud, not fail-fatal (quiz gate below is the precedent):
      // the lab is one feature and must not take the storefront down.
      // A failed lab init logs loudly and skips the runtime publish,
      // so lab routes fail closed while boot completes — UNLESS staged
      // content sits under the static /__pilot namespace: Next serves
      // it without invoking lab handlers, and with no runtime there is
      // no binding set to check it against, so serving it would be
      // silent unbound exposure. That boot refuses; a fillers-only (or
      // absent) tree keeps the fail-loud behavior.
      let runtime = null;
      try {
        runtime = await initializeLabRuntime();
      } catch (error) {
        console.error(
          'merchant image pilot: lab runtime initialization failed during boot; lab routes will fail closed',
          error
        );
        const { assertNoUnboundStagedContent } = await import(
          '@/config/pilot-public-assets-triage'
        );
        assertNoUnboundStagedContent(pilotPublicDir);
      }
      // Static-namespace binding check, also fatal: Next serves
      // public/__pilot without invoking lab handlers, so unbound files
      // present at boot would stay publicly servable even though no lab
      // page validates them. A successful init with a drifting tree
      // refuses boot with the re-stage fix; a failed init was already
      // refused above when staged content exists, so reaching here with
      // no runtime means a fillers-only or absent tree.
      if (runtime) {
        const { assertNoUnexpectedStagedFiles } = await import(
          '@/lib/merchant-image-variant-pilot/lab-config-stage-guard'
        );
        await assertNoUnexpectedStagedFiles(
          runtime.stagedPaths,
          join(pilotPublicDir, '__pilot')
        );
      }
    }
    // The Places Legacy routes must put the API key in the URL. Their fetch
    // calls opt out of @vercel/otel spans, so disable Next's separate fetch
    // spans too; those spans include the full URL and do not honor that option.
    process.env.NEXT_OTEL_FETCH_DISABLED = '1';

    const { registerOTel } = await import('@vercel/otel');

    registerOTel({
      serviceName: 'baci-web',
      // Attributes added to every span for multi-tenant filtering
      attributes: {
        'deployment.environment':
          process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
      },
    });

    // Keep backend visibility in the existing server telemetry stream. Emit
    // each fixed-cardinality outcome once per process to avoid per-request
    // analytics traffic; the hook contains no request or provider details.
    const [{ setRateLimitDiagnosticHook }, { captureServerEvent }] =
      await Promise.all([
        import('@/lib/rate-limit'),
        import('@/lib/posthog/server'),
      ]);
    setRateLimitDiagnosticHook((diagnostic) => {
      const key = `${diagnostic.backend}:${diagnostic.reason}`;
      if (
        reportedRateLimitBackends.has(key) ||
        pendingRateLimitBackends.has(key)
      ) {
        return;
      }
      pendingRateLimitBackends.add(key);
      let delivery: ReturnType<typeof captureServerEvent>;
      try {
        delivery = captureServerEvent('rate_limit_backend', {
          backend: diagnostic.backend,
          reason: diagnostic.reason,
          telemetry_source: 'rate_limit',
        });
      } catch {
        pendingRateLimitBackends.delete(key);
        return;
      }
      void Promise.resolve(delivery).then(
        (captured) => {
          pendingRateLimitBackends.delete(key);
          if (captured) {
            reportedRateLimitBackends.add(key);
          }
        },
        () => {
          pendingRateLimitBackends.delete(key);
        }
      );
    });

    // Fail-loud (not fail-fatal): if this is a production deployment but
    // QUIZ_PHASE is still "1a", the prize/compliance/age guards silently degrade
    // to fail-closed stubs. Surface it at boot so an operator notices before
    // launch. We log rather than crash — the quiz is one feature and must not
    // take the whole storefront down; the runtime guards still fail closed.
    try {
      const [{ getQuizPhaseEnv }, { assertQuizPhaseMatchesDeployment }] =
        await Promise.all([
          import('@/env'),
          import('@/lib/quiz-compliance-gate'),
        ]);
      assertQuizPhaseMatchesDeployment(getQuizPhaseEnv());
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.name !== 'QuizPhaseMisconfiguredError'
      ) {
        console.error(
          'Quiz deployment phase validation failed during boot',
          error
        );
      }
      // QuizPhaseMisconfiguredError is already logged by the assertion. Other
      // boot failures are logged above; all remain non-fatal to the storefront.
    }
  }
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context
) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  const { captureServerException } = await import('@/lib/posthog/server');

  const nextErrorDigest = getNextErrorDigest(error);

  await captureServerException(error, {
    ...(nextErrorDigest ? { next_error_digest: nextErrorDigest } : {}),
    request_path: stripQueryAndHash(request.path),
    request_method: request.method,
    ...getRequestTenantContext(request.headers),
    router_kind: context.routerKind,
    route_path: context.routePath,
    route_type: context.routeType,
    render_source: context.renderSource,
    revalidate_reason: context.revalidateReason,
  });
};
