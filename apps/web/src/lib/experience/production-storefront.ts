import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createDurablePrerenderArtifacts } from '../../../tools/experience-runner/durable-prerender-artifacts';
import type { runLocalQualification } from '../../../tools/experience-runner/local-oci-executor';
import { createProductionPublishedDelivery } from '../../../tools/experience-runner/published-delivery';
import { createPrivatePrerenderDocument } from './private-prerender-document';
import { createPublicOutputReader } from './public-output-reader';
import { createPublicRenderCache } from './public-render-cache';
import { createPublicExperienceRuntime } from './public-runtime';

/** Read-only production ports; constructing these ports never publishes a store. */
export function createProductionStorefront(settings: {
  client: SupabaseClient;
  artifactDirectory: string;
  executionOrigin: string;
  canonicalBase: (slug: string) => string;
  catalogImages?: ReadonlyMap<string, { assetId: string; alt: string }>;
  execute: typeof runLocalQualification;
}) {
  const artifacts = createDurablePrerenderArtifacts(settings.artifactDirectory);
  const reader = createPublicOutputReader(settings.client);
  const fragments = createPublicRenderCache();
  const runtime = createPublicExperienceRuntime({
    client: settings.client,
    runtimeBase: settings.executionOrigin,
    canonicalBase: settings.canonicalBase,
    prerenderDelivery: true,
    catalogImages: settings.catalogImages,
  });
  const render: Parameters<
    typeof createProductionPublishedDelivery
  >[0]['render'] = async (input) => {
    const identity = { id: input.merchantId, slug: input.slug };
    const [binding, before] = await Promise.all([
      reader.prerenderBinding(input.slug, input.buildDigest),
      runtime.resolveBoundary(identity, input.path),
    ]);
    if (
      !binding ||
      binding.merchantId !== input.merchantId ||
      !before ||
      before.manifest.buildDigest !== input.buildDigest
    )
      throw Error('NOT_FOUND');
    const renderer = artifacts.read(binding);
    const key = createHash('sha256')
      .update(JSON.stringify([binding, before.manifest, before.bootstrap]))
      .digest('hex');
    const markup = await fragments.read(key, async () => {
      const result = (
        await settings.execute('prerender', {
          javascript: renderer.javascript,
          bootstrap: before.bootstrap,
        })
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
    });
    const [after, afterBinding] = await Promise.all([
      runtime.resolveBoundary(identity, input.path),
      reader.prerenderBinding(input.slug, input.buildDigest),
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
      const hostOrigin = new URL(settings.canonicalBase(slug)).origin;
      return await createProductionPublishedDelivery({
        reader,
        hostOrigin,
        executionOrigin: settings.executionOrigin,
        render,
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
