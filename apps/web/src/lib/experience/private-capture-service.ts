import { randomUUID } from 'node:crypto';
import type {
  ExperienceManifest,
  PublicBootstrap,
} from '@baci/shared/experience';
import { experienceId } from '@/schemas/experience-id';
import { parseExperienceManifest } from '@/schemas/experience-manifest';
import { captureExperience } from '../../../tools/experience-runner/capture-route';
import { loadOfflineAssets } from './asset-service';
import {
  type OwnerRequestContext,
  requireExperienceOwner,
} from './authorization';
import { digestBytes } from './manifest-digest';
import {
  captureReplayState,
  findCaptureReplay,
  loadCaptureReplay,
  validateCaptureReplay,
} from './private-capture-replay';
import { productionOrigin } from './production-origins';
import type { ExperienceSnapshot } from './snapshot-freshness';
import { snapshotKeyDigest } from './snapshot-key';
export interface RecordedPrivateCapture {
  id: string;
  merchantId: string;
  buildId: string;
  buildDigest: string;
  snapshot: ExperienceSnapshot;
  keyDigest: string;
  bytes: Uint8Array;
  evidenceDigest: string;
}
export function createPrivateExperienceCapture(deps: {
  profile?: 'production';
  previewOrigin?: string;
  hostOrigin: string;
  bootstrap(
    ctx: OwnerRequestContext,
    manifest: ExperienceManifest,
    routeId: string
  ): Promise<PublicBootstrap>;
  record(capture: RecordedPrivateCapture): Promise<void>;
  capture?: typeof captureExperience;
  maxPendingCaptures?: number;
}) {
  const capacity = deps.maxPendingCaptures ?? 32;
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 128)
    throw Error('INVALID_CAPTURE_CAPACITY');
  const origin = new URL(deps.hostOrigin);
  if (deps.profile === 'production') {
    productionOrigin(deps.hostOrigin);
    if (deps.previewOrigin) productionOrigin(deps.previewOrigin);
    if (!deps.capture) throw Error('INCOMPLETE_PRODUCTION_CAPTURE');
  } else if (
    origin.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(origin.hostname) ||
    origin.origin !== deps.hostOrigin
  )
    throw Error('LOCAL_ORIGIN_REQUIRED');
  const cache = new Map<
    string,
    {
      fingerprint: string;
      value: Promise<{
        evidenceId: string;
        buildId: string;
        buildDigest: string;
        previewUrl: string;
      }>;
    }
  >();
  return async (
    inputCtx: OwnerRequestContext,
    input: { buildId: string; routeId: string; idempotencyKey: string }
  ) => {
    experienceId.parse(input.buildId);
    experienceId.parse(input.idempotencyKey);
    const ctx = await requireExperienceOwner(inputCtx);
    const key = [
      ctx.merchantId,
      ctx.actorUserId,
      ctx.identity?.connectionId ?? 'owner',
      ctx.identity?.grantVersion ?? 0,
      input.idempotencyKey,
    ].join(':');
    const fingerprint = digestBytes(JSON.stringify(input));
    const prior = cache.get(key);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw Error('IDEMPOTENCY_CONFLICT');
      return prior.value;
    }
    if (cache.size >= capacity) throw Error('QUOTA_EXCEEDED');
    const value = (async () => {
      const priorBinding = await loadCaptureReplay(
        ctx.supabase,
        ctx.merchantId,
        input
      );
      const build = await ctx.supabase
        .from('experience_builds')
        .select('id,build_digest,job_id,host_origin')
        .eq('merchant_id', ctx.merchantId)
        .eq('id', input.buildId)
        .maybeSingle();
      if (
        build.error ||
        !build.data ||
        build.data.host_origin !== deps.hostOrigin
      )
        throw Error('NOT_FOUND');
      const buildData = build.data;
      const job = await ctx.supabase
        .from('experience_jobs')
        .select('artifact_id,status')
        .eq('merchant_id', ctx.merchantId)
        .eq('id', build.data.job_id)
        .maybeSingle();
      if (job.error || job.data?.status !== 'finalized')
        throw Error('BUILD_FAILED');
      const artifact = await ctx.supabase
        .from('experience_artifacts')
        .select('manifest')
        .eq('merchant_id', ctx.merchantId)
        .eq('id', job.data.artifact_id)
        .maybeSingle();
      if (artifact.error || !artifact.data) throw Error('NOT_FOUND');
      const manifest = parseExperienceManifest(artifact.data.manifest);
      if (
        !manifest.routes.some(
          (r) => r.path === input.routeId || r.view === input.routeId
        )
      )
        throw Error('NOT_FOUND');
      const files = await ctx.supabase
        .from('experience_build_files')
        .select('path,bytes,digest')
        .eq('merchant_id', ctx.merchantId)
        .eq('build_id', input.buildId)
        .limit(2);
      if (files.error || files.data?.length !== 2) throw Error('BUILD_FAILED');
      const read = (path: string) => {
        const f = files.data.find((f) => f.path === path);
        if (!f) throw Error('BUILD_FAILED');
        const b = Buffer.from(f.bytes.slice(2), 'hex');
        if (digestBytes(b) !== f.digest) throw Error('BUILD_FAILED');
        return b.toString('utf8');
      };
      const javascript = read('app.js');
      const css = read('app.css');
      if (digestBytes(`${javascript}\0${css}`) !== build.data.build_digest)
        throw Error('BUILD_FAILED');
      const assets = manifest.assets.length
        ? await loadOfflineAssets(
            ctx,
            manifest.assets.map((a) => a.assetId)
          )
        : [];
      const bootstrap = await deps.bootstrap(ctx, manifest, input.routeId);
      const assetsDigest = digestBytes(
        JSON.stringify(assets.map((a) => a.digest))
      );
      const state = captureReplayState(input);
      const expectedKey = snapshotKeyDigest({
        build: build.data.build_digest,
        assets: assetsDigest,
        catalog: bootstrap.catalog.revision,
        path: bootstrap.route.canonicalPath,
        viewport: '390',
        locale: 'en-NG',
        browser: 'chromium',
        state,
      });
      const findReplay = () =>
        findCaptureReplay(
          ctx.supabase,
          ctx.merchantId,
          input,
          buildData.build_digest,
          expectedKey
        );
      const priorEvidence = validateCaptureReplay(
        priorBinding,
        build.data.build_digest,
        expectedKey
      );
      const result = (evidenceId: string) => ({
        evidenceId,
        buildId: input.buildId,
        buildDigest: buildData.build_digest,
        previewUrl: `${deps.previewOrigin ?? deps.hostOrigin}/builder/experience/preview?${new URLSearchParams({ merchant: ctx.merchantId, build: input.buildId, routeId: input.routeId })}`,
      });
      if (priorEvidence) {
        await requireExperienceOwner(ctx);
        return result(priorEvidence);
      }
      const captured = await (deps.capture ?? captureExperience)({
        manifest,
        hostOrigin: deps.hostOrigin,
        bundle: { javascript, css, digest: build.data.build_digest },
        bootstrap,
        assets,
        engine: 'chromium',
        width: 390,
        assetsDigest,
      });
      const snapshot = {
        ...captured.snapshot,
        key: {
          ...captured.snapshot.key,
          state,
        },
      };
      const bytes = captured.evidence.bytes;
      const id = randomUUID();
      await requireExperienceOwner(ctx);
      if (snapshotKeyDigest(snapshot.key) !== expectedKey)
        throw Error('BUILD_FAILED');
      try {
        await deps.record({
          id,
          merchantId: ctx.merchantId,
          buildId: input.buildId,
          buildDigest: build.data.build_digest,
          snapshot,
          keyDigest: expectedKey,
          bytes,
          evidenceDigest: digestBytes(bytes),
        });
      } catch (error) {
        const recovered = await findReplay();
        if (!recovered) throw error;
        await requireExperienceOwner(ctx);
        return result(recovered);
      }
      return result(id);
    })();
    cache.set(key, { fingerprint, value });
    try {
      return await value;
    } finally {
      if (cache.get(key)?.value === value) cache.delete(key);
    }
  };
}
