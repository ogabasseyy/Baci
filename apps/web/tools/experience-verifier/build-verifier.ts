import {
  type ExperienceManifest,
  type PublicBootstrap,
  sourceDigest,
} from '@baci/shared/experience';
import { z } from 'zod';
import { loadOfflineAssets } from '@/lib/experience/asset-service';
import {
  type OwnerRequestContext,
  requireExperienceOwner,
} from '@/lib/experience/authorization';
import { assertCandidatePerformanceBudget } from '@/lib/experience/candidate-performance-budget';
import type { VerifierReceipt } from '@/lib/experience/local-build-supervisor-types';
import {
  productionDeliveryOrigins,
  productionOrigin,
} from '@/lib/experience/production-origins';
import { qualifyBuildRender } from '@/lib/experience/qualify-build-render';
import { createExperienceRepository } from '@/lib/experience/repository';
import { parseExperienceManifest } from '@/schemas/experience-manifest';
import type { runLocalQualification } from '../experience-runner/local-oci-executor';
import { unpackPrerenderBuild } from '../experience-runner/prerender-artifacts';
import { packPrivateBuild } from '../experience-runner/private-build-payload';

const request = z.strictObject({
  jobId: z.uuid(),
  attemptNonce: z.uuid(),
  buildDigest: z.string().regex(/^[a-f0-9]{64}$/),
  receiptDigest: z.string().regex(/^[a-f0-9]{64}$/),
  hostOrigin: z.string().max(1000),
});

/** Separately trusted verifier: re-reads source and independently runs qualification. */
export function createIndependentBuildVerifier(settings: {
  execute: typeof runLocalQualification;
  bootstrap(
    ctx: OwnerRequestContext,
    manifest: ExperienceManifest,
    routeId: string
  ): Promise<PublicBootstrap>;
  canonicalBase(
    slug: string,
    client: OwnerRequestContext['supabase']
  ): string | Promise<string>;
  previewOrigin: string;
  executionOrigin: string;
  record(receipt: VerifierReceipt): Promise<void>;
}) {
  return async (inputCtx: OwnerRequestContext, value: unknown) => {
    const input = request.parse(value);
    const hostOrigin = productionOrigin(input.hostOrigin);
    productionDeliveryOrigins({
      executionOrigin: settings.executionOrigin,
      hostOrigins: [hostOrigin, settings.previewOrigin],
    });
    const ctx = await requireExperienceOwner(inputCtx);
    const repo = createExperienceRepository(ctx);
    const job = await repo.loadOwnedJob(input.jobId);
    const currentAttempt = (row: typeof job) =>
      row.status === 'running' &&
      row.attempt_nonce === input.attemptNonce &&
      row.source_digest === job.source_digest &&
      Date.parse(row.expires_at) > Date.now();
    if (!currentAttempt(job)) throw Error('BUILD_FAILED');
    const merchant = await ctx.supabase
      .from('merchants')
      .select('slug')
      .eq('id', ctx.merchantId)
      .maybeSingle();
    if (merchant.error || typeof merchant.data?.slug !== 'string')
      throw Error('BUILD_FAILED');
    const canonical = new URL(
      await settings.canonicalBase(merchant.data.slug, ctx.supabase)
    );
    if (
      canonical.username ||
      canonical.password ||
      canonical.search ||
      canonical.hash ||
      canonical.origin !== hostOrigin
    )
      throw Error('BUILD_FAILED');
    const source = await ctx.supabase
      .from('experience_artifacts')
      .select('manifest')
      .eq('merchant_id', ctx.merchantId)
      .eq('id', job.artifact_id)
      .maybeSingle();
    if (source.error || !source.data) throw Error('BUILD_FAILED');
    const manifest = parseExperienceManifest(source.data.manifest);
    if (sourceDigest(manifest) !== job.source_digest)
      throw Error('BUILD_FAILED');
    const route =
      manifest.routes.find((item) => item.view === 'home') ??
      manifest.routes.find((item) => item.view !== 'product') ??
      manifest.routes[0];
    if (!route) throw Error('BUILD_FAILED');
    const bootstrap = await settings.bootstrap(ctx, manifest, route.view);
    const payload = packPrivateBuild(
      manifest,
      hostOrigin,
      'production',
      settings.previewOrigin
    );
    const first = unpackPrerenderBuild(
      (await settings.execute('prerender-build', payload)).output
    );
    const second = unpackPrerenderBuild(
      (await settings.execute('prerender-build', payload)).output
    );
    if (
      first.client.digest !== input.buildDigest ||
      first.client.hostOrigin !== hostOrigin ||
      second.client.digest !== first.client.digest ||
      second.renderer.digest !== first.renderer.digest
    )
      throw Error('BUILD_FAILED');
    const assets = manifest.assets.length
      ? await loadOfflineAssets(
          ctx,
          manifest.assets.map((item) => item.assetId)
        )
      : [];
    assertCandidatePerformanceBudget({
      javascript: first.client.javascript,
      css: first.client.css,
      assets,
    });
    const rendered = (
      await settings.execute('prerender', {
        javascript: first.renderer.javascript,
        bootstrap,
      })
    ).output;
    if (
      !rendered ||
      typeof rendered !== 'object' ||
      !('format' in rendered) ||
      rendered.format !== 'baci-prerender/v1' ||
      !('html' in rendered) ||
      typeof rendered.html !== 'string'
    )
      throw Error('BUILD_FAILED');
    assertCandidatePerformanceBudget({
      javascript: '',
      css: '',
      ssrHtml: rendered.html,
      assets: [],
    });
    await qualifyBuildRender({
      execute: settings.execute,
      candidate: first.client,
      independentOutput: second.client,
      readCandidate: () => first.client,
      manifest,
      bootstrap,
      assets,
      hostOrigins: [...new Set([hostOrigin, settings.previewOrigin])],
    });
    await requireExperienceOwner(ctx);
    if (!currentAttempt(await repo.loadOwnedJob(job.id)))
      throw Error('BUILD_FAILED');
    const latestCanonical = new URL(
      await settings.canonicalBase(merchant.data.slug, ctx.supabase)
    );
    if (
      latestCanonical.username ||
      latestCanonical.password ||
      latestCanonical.search ||
      latestCanonical.hash ||
      latestCanonical.origin !== hostOrigin
    )
      throw Error('BUILD_FAILED');
    await settings.record({ merchantId: ctx.merchantId, ...input });
  };
}
