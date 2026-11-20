import type {
  ExperienceManifest,
  PublicBootstrap,
} from '@baci/shared/experience';
import type { SupabaseClient } from '@supabase/supabase-js';
import { captureExperience } from '../../../tools/experience-runner/capture-route';
import { createProductionPreviewDelivery } from '../../../tools/experience-runner/preview-delivery';
import { createRunnerExecutor } from '../../../tools/experience-runner/runner-transport';
import {
  type OwnerRequestContext,
  requireExperienceOwner,
} from './authorization';
import { isCanonicalMerchantSlug } from './canonical-domain';
import type { ExperienceCompositionSettings } from './compose-runtime';
import {
  createProductionPrerenderPipeline,
  type PrerenderPipelineSettings,
} from './local-prerender-pipeline';
import { loadOwnerPreviewBootstrap } from './owner-preview-bootstrap';
import { readPreviewBindingLiveness } from './preview-binding-liveness';
import { createPreviewVault } from './preview-service';
import {
  createPrivateExperienceCapture,
  type RecordedPrivateCapture,
} from './private-capture-service';
import { productionDeliveryOrigins } from './production-origins';
import { createProductionStorefront } from './production-storefront';

/** Explicit, disabled-by-default composition. Normal MCP authorization stays in
 * Baci. Runner receives only source/public bootstrap; delivery receives output.
 * A trusted operator must separately install ports and satisfy existing flags.
 * One process/owned persistent volume pilot; no HA or provisioning is implied. */
export function createProductionExperienceIntegration(settings: {
  hostOrigin: string;
  previewOrigin?: string;
  executionOrigin: string;
  artifactDirectory: string;
  canonicalBase: (
    slug: string,
    signal?: AbortSignal
  ) => string | Promise<string>;
  publicClient: SupabaseClient;
  readPublishedRenderer?: Parameters<
    typeof createProductionStorefront
  >[0]['readPublishedRenderer'];
  catalogImages?: ReadonlyMap<string, { assetId: string; alt: string }>;
  authenticate: ExperienceCompositionSettings['authenticate'];
  resolveUserClient: ExperienceCompositionSettings['dispatcher']['resolveUserClient'];
  legacyGateway: ExperienceCompositionSettings['legacyGateway'];
  approval: NonNullable<ExperienceCompositionSettings['owner']['approval']>;
  runner: Parameters<typeof createRunnerExecutor>[0];
  build: Omit<
    PrerenderPipelineSettings['build'],
    'execute' | 'profile' | 'hostOrigin'
  >;
  bootstrap?(
    ctx: OwnerRequestContext,
    manifest: ExperienceManifest,
    routeId: string
  ): Promise<PublicBootstrap>;
  recordCapture?(capture: RecordedPrivateCapture): Promise<void>;
  remoteCapture?: ReturnType<typeof createPrivateExperienceCapture>;
}) {
  const previewOrigin = settings.previewOrigin ?? settings.hostOrigin;
  const bootstrap = settings.bootstrap ?? loadOwnerPreviewBootstrap;
  productionDeliveryOrigins({
    executionOrigin: settings.executionOrigin,
    hostOrigins: [settings.hostOrigin, previewOrigin],
  });
  if (settings.build.toolchainDigest !== settings.runner.toolchainDigest)
    throw Error('TOOLCHAIN_MISMATCH');
  if (!settings.remoteCapture && !settings.recordCapture)
    throw Error('VERIFIER_NOT_CONFIGURED');
  let active = true;
  const guarded = (remoteExecute: ReturnType<typeof createRunnerExecutor>) => {
    const withSignal: typeof remoteExecute.withSignal = async (
      kind,
      payload,
      signal
    ) => {
      if (!active) throw Error('PROFILE_DISABLED');
      const result = await remoteExecute.withSignal(kind, payload, signal);
      if (!active) throw Error('PROFILE_DISABLED');
      return result;
    };
    return Object.assign(
      (kind: Parameters<typeof withSignal>[0], payload: unknown) =>
        withSignal(kind, payload),
      { withSignal }
    );
  };
  const ownerExecutor = createRunnerExecutor({
    ...settings.runner,
    lane: 'owner',
  });
  const execute = guarded(ownerExecutor);
  const publicExecute = guarded(
    createRunnerExecutor({ ...settings.runner, lane: 'public-render' })
  );
  const vault = createPreviewVault({
    origin: settings.executionOrigin,
    now: Date.now,
    async isActive(binding, signal) {
      if (!active) return false;
      const live = await readPreviewBindingLiveness(
        settings.publicClient,
        binding,
        signal
      );
      return active && live;
    },
  });
  const pipelines = new Map<
    string,
    {
      pipeline: ReturnType<typeof createProductionPrerenderPipeline>;
      capture: ReturnType<typeof createPrivateExperienceCapture>;
    }
  >();
  const pipelineFor = async (
    input: OwnerRequestContext,
    scope: 'storefront.read' | 'storefront.write' = 'storefront.write'
  ) => {
    if (!active) throw Error('PROFILE_DISABLED');
    const owner = await requireExperienceOwner(input, scope);
    const signal = owner.signal;
    const lookup = owner.supabase
      .from('merchants')
      .select('slug')
      .eq('id', owner.merchantId);
    const merchant = await (signal
      ? lookup.abortSignal(signal)
      : lookup
    ).maybeSingle();
    signal?.throwIfAborted();
    if (
      merchant.error ||
      !merchant.data ||
      typeof merchant.data.slug !== 'string' ||
      !isCanonicalMerchantSlug(merchant.data.slug)
    )
      throw Error('NOT_FOUND');
    const canonicalBase = await (signal
      ? settings.canonicalBase(merchant.data.slug, signal)
      : settings.canonicalBase(merchant.data.slug));
    signal?.throwIfAborted();
    const canonicalOrigin = new URL(canonicalBase).origin;
    productionDeliveryOrigins({
      executionOrigin: settings.executionOrigin,
      hostOrigins: [canonicalOrigin, previewOrigin],
    });
    const key = JSON.stringify([owner.merchantId, canonicalBase]);
    let entry = pipelines.get(key);
    if (!entry) {
      const pipeline = createProductionPrerenderPipeline({
        artifactDirectory: settings.artifactDirectory,
        canonicalBase,
        executionOrigin: settings.executionOrigin,
        vault,
        previewExecute: execute.withSignal,
        build: {
          ...settings.build,
          verifiedRendererStorage: Boolean(settings.readPublishedRenderer),
          hostOrigin: canonicalOrigin,
          previewOrigin,
          execute,
        },
        bootstrap,
      });
      const capture =
        settings.remoteCapture ??
        createPrivateExperienceCapture({
          profile: 'production',
          hostOrigin: canonicalOrigin,
          previewOrigin,
          bootstrap,
          record:
            settings.recordCapture ??
            (() => Promise.reject(Error('VERIFIER_NOT_CONFIGURED'))),
          capture: (input, signal) =>
            captureExperience(input, (kind, payload) =>
              execute.withSignal(kind, payload, signal)
            ),
        });
      if (pipelines.size >= 32) {
        const oldest = pipelines.keys().next().value;
        if (oldest) pipelines.delete(oldest);
      }
      entry = { pipeline, capture };
      pipelines.set(key, entry);
    }
    if (!active) throw Error('PROFILE_DISABLED');
    return entry;
  };
  const published = createProductionStorefront({
    client: settings.publicClient,
    readPublishedRenderer: settings.readPublishedRenderer,
    artifactDirectory: settings.artifactDirectory,
    executionOrigin: settings.executionOrigin,
    canonicalBase: settings.canonicalBase,
    catalogImages: settings.catalogImages,
    execute: publicExecute.withSignal,
  });
  const privateDelivery = createProductionPreviewDelivery({
    vault,
    executionOrigin: settings.executionOrigin,
    hostOrigins: [previewOrigin],
  });
  const composition: ExperienceCompositionSettings = {
    profile: 'production',
    hostOrigin: previewOrigin,
    runtimeBase: settings.executionOrigin,
    authenticate: async (request) => {
      if (!active) throw Error('PROFILE_DISABLED');
      const identity = await settings.authenticate(request);
      if (!active) throw Error('PROFILE_DISABLED');
      return identity;
    },
    legacyGateway: settings.legacyGateway,
    dispatcher: {
      rendering: 'prerender-private',
      finalizeBuild: async (ctx, input) =>
        (await pipelineFor(ctx)).pipeline.finalizeBuild(ctx, input),
      readPerformance: async (binding, trusted) =>
        trusted
          ? (
              await pipelineFor(trusted.ctx, 'storefront.read')
            ).pipeline.readPerformance(binding, trusted)
          : undefined,
      preview: async (ctx, input) =>
        (await pipelineFor(ctx)).capture(ctx, input),
      resolveUserClient: async (identity, signal) => {
        if (!active) throw Error('PROFILE_DISABLED');
        const client = await settings.resolveUserClient(identity, signal);
        if (!active) throw Error('PROFILE_DISABLED');
        return client;
      },
    },
    owner: {
      approval: settings.approval,
      createPreviewLaunch: async (ctx, input) =>
        (await pipelineFor(ctx)).pipeline.owner.createPreviewLaunch(ctx, input),
    },
    storefront: published.runtime,
  };
  return {
    composition,
    async deliver(request: Request) {
      if (!active)
        return new Response(null, {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
        });
      const response = await (new URL(request.url).pathname.startsWith(
        '/resource/'
      )
        ? privateDelivery(request)
        : published.deliver(request));
      return active
        ? response
        : new Response(null, {
            status: 503,
            headers: { 'Cache-Control': 'no-store' },
          });
    },
    dispose() {
      active = false;
      pipelines.clear();
    },
  };
}
