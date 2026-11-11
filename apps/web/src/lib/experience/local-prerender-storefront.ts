import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createDurablePrerenderArtifacts } from '../../../tools/experience-runner/durable-prerender-artifacts';
import { runLocalQualification } from '../../../tools/experience-runner/local-oci-executor';
import { localPreviewHost } from '../../../tools/experience-runner/preview-origin';
import { startPublishedGateway } from '../../../tools/experience-runner/published-gateway';
import { createPrivatePrerenderDocument } from './private-prerender-document';
import { createPublicOutputReader } from './public-output-reader';
import { createPublicRenderCache } from './public-render-cache';
import { createPublicExperienceRuntime } from './public-runtime';
/** Normal anonymous/RLS reads; never changes a publication pointer or commerce state. */
export async function startLocalPrerenderStorefront(settings: {
  client: SupabaseClient;
  artifactDirectory: string;
  hostOrigin: string;
  canonicalBase: (slug: string) => string;
  port?: number;
  catalogImages?: ReadonlyMap<string, { assetId: string; alt: string }>;
  execute?: typeof runLocalQualification;
}) {
  if (process.env.NODE_ENV === 'production') throw Error('PROFILE_DISABLED');
  const hostOrigin = localPreviewHost(settings.hostOrigin);
  const artifacts = createDurablePrerenderArtifacts(settings.artifactDirectory);
  const reader = createPublicOutputReader(settings.client);
  const fragments = createPublicRenderCache();
  let runtime: ReturnType<typeof createPublicExperienceRuntime>;
  const gateway = await startPublishedGateway(
    reader,
    hostOrigin,
    settings.port ?? 0,
    {
      render: async (input) => {
        const identity = { id: input.merchantId, slug: input.slug };
        const [binding, before] = await Promise.all([
          reader.prerenderBinding(input.slug, input.buildDigest),
          runtime.resolveBoundary(identity, input.path),
        ]);
        if (!binding || binding.merchantId !== input.merchantId)
          throw Error('NOT_FOUND');
        if (!before || before.manifest.buildDigest !== input.buildDigest)
          throw Error('NOT_FOUND');
        const renderer = artifacts.read(binding);
        const key = createHash('sha256')
          .update(JSON.stringify([binding, before.manifest, before.bootstrap]))
          .digest('hex');
        const fragment = await fragments.read(key, async () => {
          const proof = await (settings.execute ?? runLocalQualification)(
            'prerender',
            { javascript: renderer.javascript, bootstrap: before.bootstrap }
          );
          const result = proof.output;
          if (
            !result ||
            typeof result !== 'object' ||
            !('format' in result) ||
            result.format !== 'baci-prerender/v1' ||
            !('html' in result) ||
            typeof result.html !== 'string'
          )
            throw Error('BUILD_FAILED');
          // Validate before retaining; full documents and per-launch bootstrap are never cached.
          createPrivatePrerenderDocument(
            result.html,
            before.bootstrap,
            input.resources,
            { kind: 'published', buildDigest: input.buildDigest }
          );
          return result.html;
        });
        const html = createPrivatePrerenderDocument(
          fragment,
          before.bootstrap,
          input.resources,
          { kind: 'published', buildDigest: input.buildDigest }
        );
        const [after, afterBinding] = await Promise.all([
          runtime.resolveBoundary(identity, input.path),
          reader.prerenderBinding(input.slug, input.buildDigest),
        ]);
        if (
          !after ||
          JSON.stringify(after.bootstrap) !==
            JSON.stringify(before.bootstrap) ||
          JSON.stringify(after.manifest) !== JSON.stringify(before.manifest) ||
          JSON.stringify(afterBinding) !== JSON.stringify(binding)
        )
          throw Error('STALE_SOURCE');
        return html;
      },
    }
  );
  try {
    runtime = createPublicExperienceRuntime({
      client: settings.client,
      runtimeBase: gateway.origin,
      canonicalBase: settings.canonicalBase,
      prerenderDelivery: true,
      catalogImages: settings.catalogImages,
    });
  } catch (error) {
    await gateway.close();
    throw error;
  }
  return {
    runtime,
    gateway,
    invalidateRenderCache: () => fragments.clear(),
    /** Trusted local readiness, not an HTTP/MCP authority or publication action. */
    async prepare(merchant: { id: string; slug: string }, paths: string[]) {
      if (paths.length > 16) throw Error('QUOTA_EXCEEDED');
      for (const path of paths) {
        const boundary = await runtime.resolveBoundary(merchant, path);
        if (!boundary) throw Error('NOT_FOUND');
        const response = await fetch(boundary.launch.src);
        await response.body?.cancel();
        if (!response.ok) throw Error('BUILD_FAILED');
      }
    },
  };
}
