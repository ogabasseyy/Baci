import sharp from 'sharp';
import { experienceAssetSchema } from '@/schemas/experience-assets';
import { materializeAssets } from '../../../tools/experience-runner/materialize-assets';
import {
  type OwnerRequestContext,
  ownerRpcArgs,
  requireExperienceOwner,
} from './authorization';
import { digestBytes } from './manifest-digest';
export async function normalizeDesignAsset(value: unknown) {
  try {
    const v = experienceAssetSchema.parse(value);
    let bytes = Buffer.from(v.bytes);
    if (v.mime === 'image/png') {
      await materializeAssets(
        [{ assetId: 'incoming', mime: v.mime, digest: digestBytes(bytes) }],
        async () => bytes
      );
      bytes = await sharp(bytes, { limitInputPixels: 4000000 })
        .rotate()
        .png()
        .toBuffer();
    }
    const digest = digestBytes(bytes);
    const assetId = digest;
    await materializeAssets(
      [{ assetId, mime: v.mime, digest }],
      async () => bytes
    );
    return {
      assetId,
      digest,
      mime: v.mime,
      alt: v.alt,
      focalPoint: v.focalPoint,
      bytes,
    };
  } catch {
    throw Error('INVALID_REQUEST');
  }
}
export async function storeAsset(
  inputCtx: OwnerRequestContext,
  value: unknown,
  purpose: 'design' | 'reference'
) {
  const ctx = await requireExperienceOwner(inputCtx);
  const asset = await normalizeDesignAsset(value);
  const result = await ctx.supabase.rpc('experience_store_asset', {
    ...ownerRpcArgs(ctx),
    p_digest: asset.digest,
    p_purpose: purpose,
    p_mime: asset.mime,
    p_alt: asset.alt,
    p_bytes: asset.bytes.toString('hex'),
    p_focal: asset.focalPoint,
  });
  if (
    result.error ||
    !result.data ||
    typeof result.data.assetId !== 'string' ||
    result.data.digest !== asset.digest
  )
    throw Error('INVALID_REQUEST');
  return {
    assetId: result.data.assetId as string,
    digest: asset.digest,
    purpose,
    alt: asset.alt,
    focalPoint: asset.focalPoint,
  };
}
/** Existing catalog image import accepts owned byte resolution only, never a fetch URL. */
export async function importCatalogAsset(
  ctx: OwnerRequestContext,
  productId: string,
  resolveOwnedBytes: (ctx: OwnerRequestContext, id: string) => Promise<unknown>
) {
  await requireExperienceOwner(ctx);
  return storeAsset(ctx, await resolveOwnedBytes(ctx, productId), 'design');
}
export async function loadOfflineAssets(
  inputCtx: OwnerRequestContext,
  ids: string[]
) {
  const ctx = await requireExperienceOwner(inputCtx);
  if (ids.length > 32) throw Error('QUOTA_EXCEEDED');
  const r = await ctx.supabase
    .from('experience_assets')
    .select('asset_id,digest,mime,bytes,purpose')
    .eq('merchant_id', ctx.merchantId)
    .in('asset_id', ids)
    .limit(32);
  if (
    r.error ||
    !r.data ||
    r.data.length !== new Set(ids).size ||
    r.data.some((a) => a.purpose !== 'design')
  )
    throw Error('NOT_FOUND');
  return materializeAssets(
    r.data.map((a) => ({
      assetId: a.asset_id,
      digest: a.digest,
      mime: a.mime,
    })),
    (id) => {
      const a = r.data.find((a) => a.asset_id === id);
      return Promise.resolve(a ? Buffer.from(a.bytes.slice(2), 'hex') : null);
    }
  );
}
