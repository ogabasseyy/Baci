import type {
  ExperienceManifest,
  PublicBootstrap,
} from '@baci/shared/experience';
import { sourceDigest } from '@baci/shared/experience';
import { runLocalQualification } from '../../../tools/experience-runner/local-oci-executor';
import type { LocalPrerenderArtifacts } from '../../../tools/experience-runner/prerender-artifacts';
import {
  type ExperienceContext,
  requireExperienceOwner,
} from './authorization';
import type { PreviewVault } from './preview-service';
import { createPrivatePrerenderDocument } from './private-prerender-document';
import { buildPublicBootstrap } from './public-bootstrap';
import { readVerifiedPrerender } from './read-verified-prerender';
export interface PrerenderPreviewOptions {
  artifacts: LocalPrerenderArtifacts;
  verifiedRendererStorage?: boolean;
  executionOrigin?: string;
  previewOrigin?: string;
  bootstrap(
    ctx: ExperienceContext,
    manifest: ExperienceManifest,
    routeId: string
  ): Promise<PublicBootstrap>;
  execute?: typeof runLocalQualification;
  executeWithSignal?: (
    kind: Parameters<typeof runLocalQualification>[0],
    payload: unknown,
    signal?: AbortSignal
  ) => ReturnType<typeof runLocalQualification>;
}
export async function consumePrerenderPreview(
  ctx: ExperienceContext,
  input: {
    buildId: string;
    buildDigest: string;
    manifest: ExperienceManifest;
    routeId: string;
    ref: string;
  },
  vault: PreviewVault,
  options: PrerenderPreviewOptions,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  const binding = {
    merchantId: ctx.merchantId,
    buildId: input.buildId,
    buildDigest: input.buildDigest,
    sourceDigest: sourceDigest(input.manifest),
  };
  const managedRenderer = options.verifiedRendererStorage
    ? await readVerifiedPrerender(ctx, binding, signal)
    : null;
  const renderer = managedRenderer ?? options.artifacts.read(binding);
  let bootstrap: PublicBootstrap | undefined;
  const launch = await vault.consumePrerender(
    ctx.actorUserId,
    input.ref,
    async (resources) => {
      const fresh = await options.bootstrap(ctx, input.manifest, input.routeId);
      bootstrap = {
        ...buildPublicBootstrap(
          fresh.route,
          fresh.catalog,
          input.manifest.capabilities,
          fresh.currency
        ),
        assets: Object.fromEntries(
          resources
            .filter((r) => r.path.startsWith('assets/'))
            .map((r) => [r.path.slice(7), r.url])
        ),
      };
      signal?.throwIfAborted();
      const payload = { javascript: renderer.javascript, bootstrap };
      const proof = await (options.executeWithSignal
        ? options.executeWithSignal('prerender', payload, signal)
        : (options.execute ?? runLocalQualification)('prerender', payload));
      signal?.throwIfAborted();
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
      const document = createPrivatePrerenderDocument(
        result.html,
        bootstrap,
        resources,
        { executionOrigin: options.executionOrigin }
      );
      await requireExperienceOwner(ctx);
      return document;
    },
    signal
  );
  if (!bootstrap) throw Error('BUILD_FAILED');
  return { ...launch, bootstrap, renderMode: 'prerender' as const };
}
