import { parseExperienceManifest } from '@/schemas/experience-manifest';
import { loadOfflineAssets } from './asset-service';
import {
  type OwnerRequestContext,
  ownerRpcArgs,
  requireExperienceOwner,
} from './authorization';
import {
  consumePrerenderPreview,
  type PrerenderPreviewOptions,
} from './prerender-preview';
import type { PreviewFile, PreviewVault } from './preview-service';
export async function createPreviewLaunch(
  inputCtx: OwnerRequestContext,
  input: { buildId: string; routeId?: string },
  vault: PreviewVault,
  expectedHostOrigin?: string,
  prerender?: PrerenderPreviewOptions
) {
  const ctx = await requireExperienceOwner(inputCtx);
  const build = await ctx.supabase
    .from('experience_builds')
    .select('build_digest,job_id,host_origin')
    .eq('merchant_id', ctx.merchantId)
    .eq('id', input.buildId)
    .maybeSingle();
  if (build.error || !build.data) throw Error('NOT_FOUND');
  if (expectedHostOrigin && expectedHostOrigin !== build.data.host_origin)
    throw Error('BUILD_FAILED');
  const job = await ctx.supabase
    .from('experience_jobs')
    .select('artifact_id')
    .eq('merchant_id', ctx.merchantId)
    .eq('id', build.data.job_id)
    .maybeSingle();
  if (job.error || !job.data) throw Error('NOT_FOUND');
  const artifact = await ctx.supabase
    .from('experience_artifacts')
    .select('manifest')
    .eq('merchant_id', ctx.merchantId)
    .eq('id', job.data.artifact_id)
    .maybeSingle();
  if (artifact.error || !artifact.data) throw Error('NOT_FOUND');
  const manifest = parseExperienceManifest(artifact.data.manifest);
  const routeId = input.routeId ?? manifest.routes[0]?.path;
  if (!routeId) throw Error('NOT_FOUND');
  if (!manifest.routes.some((r) => r.path === routeId || r.view === routeId))
    throw Error('NOT_FOUND');
  const bytes = await ctx.supabase
    .from('experience_build_files')
    .select('path,mime,bytes,digest')
    .eq('merchant_id', ctx.merchantId)
    .eq('build_id', input.buildId)
    .limit(2);
  if (bytes.error || bytes.data?.length !== 2) throw Error('BUILD_FAILED');
  const files: PreviewFile[] = bytes.data.map((f) => ({
    ...f,
    bytes: Buffer.from(f.bytes.slice(2), 'hex'),
  }));
  if (manifest.assets.length) {
    const assets = await loadOfflineAssets(
      ctx,
      manifest.assets.map((a) => a.assetId)
    );
    files.push(
      ...assets.map((a) => ({
        path: `assets/${a.assetId}`,
        mime: a.mime,
        digest: a.digest,
        bytes: Buffer.from(a.bytesBase64, 'base64'),
      }))
    );
  }
  const binding = await ctx.supabase.rpc('experience_create_preview_binding', {
    ...ownerRpcArgs(ctx),
    p_build: input.buildId,
  });
  if (binding.error || typeof binding.data !== 'string')
    throw Error('NOT_FOUND');
  const ref = vault.create({
    ownerId: ctx.actorUserId,
    merchantId: ctx.merchantId,
    bindingId: binding.data,
    buildDigest: build.data.build_digest,
    files,
  });
  try {
    return {
      ...(prerender
        ? await consumePrerenderPreview(
            ctx,
            {
              buildId: input.buildId,
              buildDigest: build.data.build_digest,
              manifest,
              routeId,
              ref,
            },
            vault,
            prerender
          )
        : vault.consume(ctx.actorUserId, ref)),
      hostOrigin: build.data.host_origin as string,
    };
  } catch (error) {
    vault.revoke(binding.data);
    throw error;
  }
}
