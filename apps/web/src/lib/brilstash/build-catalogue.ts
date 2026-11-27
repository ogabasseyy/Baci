import { normalizeCanonicalProductCondition } from '@baci/shared/lib/product-condition';
import {
  type BrilStashProduct,
  brilstashPriceSchema,
  brilstashProductSchema,
} from '../../schemas/brilstash-feed';
import { isStorefrontProductVariantPublic } from '../is-storefront-product-variant-public';
import { sanitizeText } from '../sanitize-core';
import {
  brilStashImageUrlKey,
  parseBrilStashHttpsUrl,
} from './parse-https-url';

type Scope = { merchantId: string; installationId: string };
type BuildContext = Scope & { storefrontOrigin: string };

type Inventory =
  | { kind: 'quantity'; units: number | null; legacyUnits?: number | null }
  | { kind: 'serialized'; units: number | null }
  | { kind: 'untracked' }
  | { kind: 'on-demand'; units: number }
  | { kind: 'withdrawn'; units: 0; approvalId: string };

type ApprovedFacts = {
  specifications: string;
  boxContents: string;
  warranty: string;
};

type SourceFacts = Scope & {
  id: string;
  name: string;
  condition: string | null;
  categoryId: string;
  currency: string;
  priceNaira: number;
  productUrl: string;
  visible: boolean;
  inventory: Inventory;
  approvedFacts: ApprovedFacts | null;
  verifiedImages: readonly (string | undefined)[];
  brand?: string;
};

export type SellableSource = SourceFacts &
  (
    | { kind: 'product' }
    | {
        kind: 'variant';
        is_inventory_anchor?: boolean;
        is_active?: boolean;
        status?: string;
        archived_at?: string | null;
        deleted_at?: string | null;
      }
    | { kind: 'offer'; parentCondition?: string }
  );

const CONDITION_LABELS = new Map([
  ['new', 'New'],
  ['used', 'Used'],
  ['uk_used', 'UK Used'],
  ['open_box', 'Open Box'],
  ['refurbished', 'Refurbished'],
]);

type RejectionCode =
  | 'wrong_scope'
  | 'not_sellable'
  | 'unapproved_source'
  | 'unknown_condition'
  | 'unmapped_category'
  | 'invalid_price'
  | 'unavailable_stock'
  | 'invalid_url'
  | 'missing_facts'
  | 'missing_images'
  | 'invalid_product'
  | 'duplicate_identity'
  | 'ambiguous_selection';

type Candidate = {
  sourceRef: string;
  selectionKey: string;
  product: BrilStashProduct;
};
type Rejection = { sourceRef: string; code: RejectionCode };
export type CatalogueBuildResult = {
  products: BrilStashProduct[];
  rejected: Rejection[];
};

// The upstream loader supplies tracked stock or explicitly approved sourcing
// capacity. Neither condition offers nor variants inherit a parent count.
function resolveStock(inventory: Inventory): number | null {
  if (inventory.kind === 'untracked') return null;
  const { units } = inventory;
  if (units === null || !Number.isSafeInteger(units) || units < 0) return null;
  if (
    inventory.kind === 'quantity' &&
    units === 0 &&
    (inventory.legacyUnits ?? 0) > 0
  )
    return null;

  return units;
}

function resolveImages(verifiedImages: SourceFacts['verifiedImages']) {
  const urls = new Map<string, string>();
  for (const value of verifiedImages) {
    const key = value ? brilStashImageUrlKey(value) : null;
    if (!value || key === null) return [];
    if (urls.size < 10 && !urls.has(key)) urls.set(key, value);
  }
  return Array.from(urls.values(), (url) => ({ url }));
}

function buildDescription(conditionLabel: string, facts: ApprovedFacts | null) {
  if (!facts) return null;
  const specifications = sanitizeText(facts.specifications).replace(
    /\s+/g,
    ' '
  );
  const box = sanitizeText(facts.boxContents).replace(/\s+/g, ' ');
  const warranty = sanitizeText(facts.warranty).replace(/\s+/g, ' ');
  if (!specifications || !box || !warranty) return null;

  return `Condition: ${conditionLabel}. Specifications: ${specifications}. Box contents: ${box}. Warranty: ${warranty}.`;
}

function projectSource(
  context: BuildContext,
  source: SellableSource,
  externalId: string | undefined,
  category: string | undefined
): Omit<Candidate, 'sourceRef'> | RejectionCode {
  if (
    source.merchantId !== context.merchantId ||
    source.installationId !== context.installationId
  )
    return 'wrong_scope';
  if (
    !source.visible ||
    (source.kind === 'variant' && !isStorefrontProductVariantPublic(source))
  )
    return 'not_sellable';
  if (!externalId || !source.id) return 'unapproved_source';

  const condition = source.condition ?? '';
  const conditionLabel = CONDITION_LABELS.get(condition);
  if (!conditionLabel) return 'unknown_condition';
  const storefrontCondition = normalizeCanonicalProductCondition(condition);
  if (
    source.kind === 'offer' &&
    storefrontCondition ===
      normalizeCanonicalProductCondition(source.parentCondition)
  )
    return 'not_sellable';

  if (!category) return 'unmapped_category';
  if (
    source.currency !== 'NGN' ||
    !brilstashPriceSchema.safeParse(source.priceNaira).success
  )
    return 'invalid_price';
  const units = resolveStock(source.inventory);
  if (units === null) return 'unavailable_stock';

  const url = parseBrilStashHttpsUrl(source.productUrl);
  if (!url || url.origin !== context.storefrontOrigin) return 'invalid_url';
  // Fragments are browser-only anchors. The feed uses the canonical PDP URL.
  url.hash = '';
  url.searchParams.delete('variantId');
  url.searchParams.delete('condition');
  url.searchParams.delete('offer_id');
  if (source.kind === 'variant') url.searchParams.set('variantId', source.id);
  if (source.kind === 'offer') url.searchParams.set('offer_id', source.id);
  if (source.kind !== 'product') url.searchParams.set('condition', condition);

  const description = buildDescription(conditionLabel, source.approvedFacts);
  if (!description) return 'missing_facts';
  const images = resolveImages(source.verifiedImages);
  if (images.length === 0) return 'missing_images';

  const brand = sanitizeText(source.brand ?? '');
  const parsed = brilstashProductSchema.safeParse({
    external_id: externalId,
    product_url: url.href,
    title: sanitizeText(source.name),
    description,
    category,
    price_naira: source.priceNaira,
    stock_quantity: units,
    images,
    ...(brand && { brand }),
  });
  if (!parsed.success) return 'invalid_product';

  return {
    product: parsed.data,
    selectionKey: JSON.stringify([
      url.origin,
      url.pathname.replace(/\/$/, ''),
      source.kind,
      source.kind === 'product' ? null : source.id,
    ]),
  };
}

function repeatedKeys(
  candidates: Candidate[],
  keyOf: (row: Candidate) => string
) {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const candidate of candidates) {
    const key = keyOf(candidate);
    if (seen.has(key)) repeated.add(key);
    seen.add(key);
  }
  return repeated;
}

export function buildBrilStashCatalogue(
  context: BuildContext,
  sources: readonly SellableSource[],
  identities: ReadonlyMap<string, string>,
  categoryMap: ReadonlyMap<string, string>
): CatalogueBuildResult {
  const candidates: Candidate[] = [];
  const rejected: Rejection[] = [];

  for (const source of sources) {
    const sourceRef = `${source.kind}:${source.id}`;
    const projected = projectSource(
      context,
      source,
      identities.get(sourceRef),
      categoryMap.get(source.categoryId)
    );
    if (typeof projected === 'string') {
      rejected.push({ sourceRef, code: projected });
    } else {
      candidates.push({ sourceRef, ...projected });
    }
  }

  const duplicateIds = repeatedKeys(
    candidates,
    (row) => row.product.external_id
  );
  const ambiguousSelections = repeatedKeys(
    candidates,
    (row) => row.selectionKey
  );
  const products = [];
  for (const row of candidates) {
    if (duplicateIds.has(row.product.external_id)) {
      rejected.push({ sourceRef: row.sourceRef, code: 'duplicate_identity' });
    } else if (ambiguousSelections.has(row.selectionKey)) {
      rejected.push({ sourceRef: row.sourceRef, code: 'ambiguous_selection' });
    } else {
      products.push(row.product);
    }
  }
  products.sort((a, b) => (a.external_id < b.external_id ? -1 : 1));
  return { products, rejected };
}
