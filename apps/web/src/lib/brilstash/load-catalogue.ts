import { brilStashSourcesSchema } from '../../schemas/brilstash-sources';
import { serializeStorefrontProductPathSegment } from '../serialize-storefront-product-path-segment';
import { evaluateStorefrontSlugSafety } from '../storefront-slug-safety';
import type { SellableSource } from './build-catalogue';
import { parseBrilStashStorefrontOrigin } from './parse-https-url';

type SourceRpcClient = {
  rpc(
    name: 'load_brilstash_catalogue_sources',
    args: { p_installation_id: string }
  ): PromiseLike<{ data: unknown; error: unknown }>;
};

type LoadContext = {
  installationId: string;
  merchantId: string;
  storefrontOrigin: string;
};

export async function loadBrilStashSources(
  client: SourceRpcClient,
  context: LoadContext
) {
  const origin = parseBrilStashStorefrontOrigin(context.storefrontOrigin);
  if (!origin) {
    throw new Error('Invalid BrilStash storefront origin');
  }

  const { data, error } = await client.rpc('load_brilstash_catalogue_sources', {
    p_installation_id: context.installationId,
  });
  if (error) throw new Error('Unable to load BrilStash source data');

  const parsed = brilStashSourcesSchema.safeParse(data);
  if (
    !parsed.success ||
    parsed.data.installationId !== context.installationId ||
    parsed.data.merchantId !== context.merchantId
  ) {
    throw new Error('Invalid BrilStash source response');
  }

  const { rows, ...snapshotMetadata } = parsed.data;
  const sources: SellableSource[] = [];
  const identities = new Map<string, string>();
  const categoryMap = new Map<string, string>();
  const approvalRevisions: [string, string][] = [];

  for (const row of rows) {
    identities.set(`${row.kind}:${row.id}`, row.externalId);
    if (row.categoryId && row.partnerCategory) {
      categoryMap.set(row.categoryId, row.partnerCategory);
    }
    if (row.factsRevision) {
      approvalRevisions.push([row.externalId, row.factsRevision]);
    }
    if (
      !row.visible ||
      !row.slug ||
      !evaluateStorefrontSlugSafety(row.slug).safe ||
      row.priceNaira === null ||
      !row.currency
    ) {
      continue;
    }

    const slug = serializeStorefrontProductPathSegment(row.slug);
    if (!slug || slug === '.' || slug === '..' || /%2f|%5c/i.test(slug)) {
      continue;
    }

    sources.push({
      id: row.id,
      kind: row.kind,
      merchantId: context.merchantId,
      installationId: context.installationId,
      visible: row.visible,
      name: row.name ?? '',
      condition: row.condition,
      categoryId: row.categoryId ?? '',
      currency: row.currency,
      priceNaira: row.priceNaira,
      inventory: row.inventory,
      approvedFacts: row.approvedFacts,
      verifiedImages: row.verifiedImages,
      brand: row.brand ?? undefined,
      parentCondition: row.parentCondition ?? undefined,
      productUrl: new URL(`/products/${slug}`, origin).href,
    });
  }

  return {
    ...snapshotMetadata,
    storefrontOrigin: origin,
    sourceRows: rows,
    sources,
    identities,
    categoryMap,
    approvedExternalIds: rows.map((row) => row.externalId),
    factsRevisionsByExternalId: Object.fromEntries(approvalRevisions),
  };
}
