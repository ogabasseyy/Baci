import { isDeepStrictEqual } from 'node:util';
import { digestBytes } from '@/lib/experience/manifest-digest';
import { productionOrigin } from '@/lib/experience/production-origins';
import { parsePublishedExperience } from '@/lib/experience/published-manifest';
import { merchantHasFeature } from '@/lib/merchant-has-feature';
import {
  publicHeadApprovalId,
  publicHeadBuildDigest,
  publicHeadMerchant,
  publicHeadReceipt,
} from '@/schemas/experience-verification-records';
import { rewriteCssAssetUrls } from '../experience-runner/rewrite-css-asset-urls';

type File = { path: string; bytes: Uint8Array; digest: string; mime: string };
type Dependencies = {
  loadReceipt(id: string): Promise<unknown>;
  loadMerchant(id: string): Promise<unknown>;
  loadBuildDigest(merchantId: string, buildId: string): Promise<unknown>;
  canonicalBase(slug: string): Promise<string>;
  manifest(slug: string): Promise<unknown>;
  read(slug: string, build: string, path: string): Promise<File | null>;
};

/** Binds verifier input to a current owner-scoped receipt and public bytes. */
export async function bindPublicHead(
  approvalId: string,
  deps: Dependencies,
  accept?: () => void
) {
  const id = publicHeadApprovalId.parse(approvalId);
  const receipt = publicHeadReceipt.parse(await deps.loadReceipt(id));
  if (receipt.approvalId !== id) throw Error('PUBLIC_BINDING_MISMATCH');
  accept?.();
  const merchant = publicHeadMerchant.parse(
    await deps.loadMerchant(receipt.merchantId)
  );
  const digest = publicHeadBuildDigest.parse(
    await deps.loadBuildDigest(receipt.merchantId, receipt.buildId)
  );
  const canonicalBase = productionOrigin(
    await deps.canonicalBase(merchant.slug)
  );
  const head = parsePublishedExperience(await deps.manifest(merchant.slug));
  if (
    head.merchantId !== receipt.merchantId ||
    head.buildDigest !== digest ||
    head.version !== receipt.publishedVersion
  )
    throw Error('PUBLIC_BINDING_MISMATCH');
  const read = async (path: string, mime?: string) => {
    const value = await deps.read(merchant.slug, digest, path);
    if (
      !value ||
      value.path !== path ||
      !(value.bytes instanceof Uint8Array) ||
      value.bytes.byteLength > 16777216 ||
      digestBytes(value.bytes) !== value.digest ||
      (mime && value.mime !== mime)
    )
      throw Error('PUBLIC_BINDING_MISMATCH');
    return value;
  };
  const js = await read('app.js', 'text/javascript');
  const css = await read('app.css', 'text/css');
  if (
    digestBytes(Buffer.concat([js.bytes, Buffer.from([0]), css.bytes])) !==
    digest
  )
    throw Error('PUBLIC_BINDING_MISMATCH');
  const assets: Record<string, string> = {};
  for (const asset of head.assets)
    assets[asset.assetId] = (await read(`assets/${asset.assetId}`)).digest;
  const servedCss = rewriteCssAssetUrls(
    Buffer.from(css.bytes).toString('utf8'),
    `/published/${merchant.slug}/${digest}`,
    head.assets.map((asset) => asset.assetId)
  );
  const current = publicHeadReceipt.parse(await deps.loadReceipt(id));
  if (
    !isDeepStrictEqual(receipt, current) ||
    !isDeepStrictEqual(
      head,
      parsePublishedExperience(await deps.manifest(merchant.slug))
    ) ||
    productionOrigin(await deps.canonicalBase(merchant.slug)) !== canonicalBase
  )
    throw Error('PUBLICATION_SUPERSEDED');
  return {
    ...receipt,
    slug: merchant.slug,
    sharedCartEnabled: merchantHasFeature(merchant, 'shared_cart'),
    buildDigest: digest,
    publicationRevision: receipt.publishedVersion,
    scriptDigest: js.digest,
    styleDigest: digestBytes(Buffer.from(servedCss)),
    assets,
    head,
    canonicalBase,
  };
}
