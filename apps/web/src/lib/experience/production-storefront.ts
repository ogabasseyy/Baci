import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createDurablePrerenderArtifacts } from '../../../tools/experience-runner/durable-prerender-artifacts';
import type { PrerenderBinding } from '../../../tools/experience-runner/prerender-artifacts';
import { createProductionPublishedDelivery } from '../../../tools/experience-runner/published-delivery';
import type { createRunnerExecutor } from '../../../tools/experience-runner/runner-transport';
import type { CompiledCandidate } from './compiled-candidate';
import { createPrivatePrerenderDocument } from './private-prerender-document';
import { createPublicOutputReader } from './public-output-reader';
import { createPublicRenderCache } from './public-render-cache';
import { createPublicExperienceRuntime } from './public-runtime';

const CANONICAL_LOOKUP_TIMEOUT_MS = 5_000;

/** Read-only production ports; constructing these ports never publishes a store. */
export function createProductionStorefront(settings: {
  client: SupabaseClient;
  artifactDirectory: string;
  executionOrigin: string;
  canonicalBase: (
    slug: string,
    signal?: AbortSignal
  ) => string | Promise<string>;
  readPublishedRenderer?(
    slug: string,
    binding: PrerenderBinding,
    signal: AbortSignal
  ): Promise<CompiledCandidate | null>;
  catalogImages?: ReadonlyMap<string, { assetId: string; alt: string }>;
  execute: ReturnType<typeof createRunnerExecutor>['withSignal'];
}) {
  const canonicalBase = async (slug: string, requestedSignal?: AbortSignal) => {
    const deadline = AbortSignal.timeout(CANONICAL_LOOKUP_TIMEOUT_MS);
    const signal = requestedSignal
      ? AbortSignal.any([requestedSignal, deadline])
      : deadline;
    signal.throwIfAborted();
    const base = await settings.canonicalBase(slug, signal);
    signal.throwIfAborted();
    return base;
  };
  const artifacts = createDurablePrerenderArtifacts(settings.artifactDirectory);
  const reader = createPublicOutputReader(settings.client);
  const fragments = createPublicRenderCache();
  const runtime = createPublicExperienceRuntime({
    client: settings.client,
    runtimeBase: settings.executionOrigin,
    canonicalBase,
    prerenderDelivery: true,
    catalogImages: settings.catalogImages,
  });
  const render = async (
    input: Parameters<
      Parameters<typeof createProductionPublishedDelivery>[0]['render']
    >[0],
    signal: AbortSignal
  ) => {
    const identity = { id: input.merchantId, slug: input.slug };
    const beforeSignal = AbortSignal.any([signal, AbortSignal.timeout(5_000)]);
    const [binding, before] = await Promise.all([
      reader.prerenderBinding(input.slug, input.buildDigest, beforeSignal),
      runtime.resolveBoundary(identity, input.path, beforeSignal),
    ]);
    if (
      !binding ||
      binding.merchantId !== input.merchantId ||
      !before ||
      before.manifest.buildDigest !== input.buildDigest
    )
      throw Error('NOT_FOUND');
    const key = createHash('sha256')
      .update(JSON.stringify([binding, before.manifest, before.bootstrap]))
      .digest('hex');
    const markup = await fragments.read(
      key,
      async (renderSignal) => {
        const managed = await settings.readPublishedRenderer?.(
          input.slug,
          binding,
          renderSignal
        );
        renderSignal.throwIfAborted();
        const renderer = managed ?? artifacts.read(binding);
        const result = (
          await settings.execute(
            'prerender',
            { javascript: renderer.javascript, bootstrap: before.bootstrap },
            renderSignal
          )
        ).output;
        if (
          !result ||
          typeof result !== 'object' ||
          !('format' in result) ||
          result.format !== 'baci-prerender/v1' ||
          !('html' in result) ||
          typeof result.html !== 'string'
        )
          throw Error('BUILD_FAILED');
        createPrivatePrerenderDocument(
          result.html,
          before.bootstrap,
          input.resources,
          {
            kind: 'published',
            buildDigest: input.buildDigest,
            executionOrigin: settings.executionOrigin,
          }
        );
        return result.html;
      },
      signal
    );
    const afterSignal = AbortSignal.any([signal, AbortSignal.timeout(5_000)]);
    const [after, afterBinding] = await Promise.all([
      runtime.resolveBoundary(identity, input.path, afterSignal),
      reader.prerenderBinding(input.slug, input.buildDigest, afterSignal),
    ]);
    if (
      !after ||
      JSON.stringify(after.bootstrap) !== JSON.stringify(before.bootstrap) ||
      JSON.stringify(after.manifest) !== JSON.stringify(before.manifest) ||
      JSON.stringify(afterBinding) !== JSON.stringify(binding)
    )
      throw Error('STALE_SOURCE');
    return { markup, bootstrap: before.bootstrap };
  };
  const deliver = async (request: Request): Promise<Response> => {
    const slug = new URL(request.url).pathname.match(
      /^\/published\/([a-z0-9][a-z0-9-]{0,99})\//
    )?.[1];
    if (!slug)
      return new Response('Unavailable', {
        status: 404,
        headers: { 'Cache-Control': 'no-store' },
      });
    try {
      const hostOrigin = new URL(await canonicalBase(slug, request.signal))
        .origin;
      return await createProductionPublishedDelivery({
        reader,
        hostOrigin,
        executionOrigin: settings.executionOrigin,
        render: (input) => render(input, request.signal),
      })(request);
    } catch {
      return new Response('Unavailable', {
        status: 404,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
  };
  return { runtime, deliver };
}
