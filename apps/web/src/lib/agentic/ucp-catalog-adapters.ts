import {
  coerceStorefrontManageStock,
  getStorefrontAgentAvailability,
} from '@/lib/storefront-agent-availability';
import { buildAgentProductUrl } from '@/lib/storefront-agent-urls';
import { resolveStorefrontProductCategory } from '@/lib/storefront-product-category-precedence';
import { UCP_PROFILE_VERSION } from './ucp-discovery-profile';

export const UCP_CATALOG_SEARCH_CAPABILITY = 'dev.ucp.shopping.catalog.search';
export const UCP_CATALOG_LOOKUP_CAPABILITY = 'dev.ucp.shopping.catalog.lookup';

type StorefrontProductForUcp = {
  currency: string;
  description?: string | null;
  id: string;
  image_url?: string | null;
  in_stock: boolean;
  name: string;
  price: number;
  product_url: string;
};

export type UcpCatalogProductRow = {
  canonical_url?: string | null;
  category?: string | null;
  categories?: { is_active?: boolean | null; slug?: string | null } | null;
  description?: string | null;
  id?: string | null;
  images?: unknown;
  manage_stock?: boolean | null;
  merchant_id: string;
  name?: string | null;
  price?: number | string | null;
  product_categories?: Array<{
    category_id?: string | null;
    categories?: { is_active?: boolean | null; slug?: string | null } | null;
  }> | null;
  slug?: string | null;
  status?: string | null;
  stock?: number | string | null;
  stock_quantity?: number | string | null;
};

export type UcpCatalogProduct = ReturnType<
  typeof mapStorefrontProductToUcpCatalogProduct
>;

export function mapStorefrontProductToUcpCatalogProduct(
  product: StorefrontProductForUcp
) {
  const price = {
    amount: product.price,
    currency: product.currency.toUpperCase(),
  };
  const media = product.image_url
    ? [{ alt_text: product.name, type: 'image', url: product.image_url }]
    : [];

  return {
    id: product.id,
    title: product.name,
    description: { plain: product.description ?? '' },
    url: product.product_url,
    media,
    price_range: {
      min: price,
      max: price,
    },
    variants: [
      {
        id: product.id,
        inputs: [{ id: product.id, match: 'featured' }],
        title: product.name,
        description: { plain: product.description ?? '' },
        url: product.product_url,
        media,
        price,
        availability: { available: product.in_stock },
      },
    ],
  };
}

export function mapUcpCatalogProductRow({
  baseUrl,
  currency,
  row,
}: {
  baseUrl: string;
  currency: string;
  row: UcpCatalogProductRow;
}): UcpCatalogProduct | null {
  const numericPrice = toFiniteNonNegativeNumber(row.price);
  const trimmedId = typeof row.id === 'string' ? row.id?.trim() : undefined;
  const trimmedName =
    typeof row.name === 'string' ? row.name?.trim() : undefined;
  if (numericPrice === null || !trimmedId || !trimmedName) {
    return null;
  }

  const manageStock = coerceStorefrontManageStock(row.manage_stock);
  const availability = getStorefrontAgentAvailability({
    manage_stock: manageStock,
    stock: row.stock,
    stock_quantity: row.stock_quantity,
  });

  return mapStorefrontProductToUcpCatalogProduct({
    currency,
    description: row.description,
    id: trimmedId,
    image_url: extractPrimaryImageUrl(row.images),
    in_stock: availability.is_purchasable,
    name: trimmedName,
    price: numericPrice,
    product_url: buildAgentProductUrl({
      baseUrl,
      product: {
        canonical_url: row.canonical_url ?? null,
        category: row.category ?? null,
        categories: resolveStorefrontProductCategory(row),
        id: trimmedId,
        name: trimmedName,
        slug: row.slug ?? undefined,
      },
    }),
  });
}

export function filterActiveUcpCatalogProductRows<
  T extends { status?: string | null },
>(rows: T[]): T[] {
  return rows.filter((row) => row.status === 'active');
}

export function buildUcpCatalogProductsResponse({
  capability,
  products,
}: {
  capability: string;
  products: UcpCatalogProduct[];
}) {
  return {
    products,
    messages: [],
    ucp: buildUcpCatalogEnvelope(capability),
  };
}

export function buildUcpCatalogProductResponse(product: UcpCatalogProduct) {
  return {
    product,
    messages: [],
    ucp: buildUcpCatalogEnvelope(UCP_CATALOG_LOOKUP_CAPABILITY),
  };
}

function buildUcpCatalogEnvelope(capability: string) {
  return {
    version: UCP_PROFILE_VERSION,
    status: 'success',
    capabilities: {
      [capability]: [{ version: UCP_PROFILE_VERSION }],
    },
  };
}

function extractPrimaryImageUrl(images: unknown): string | null {
  if (!Array.isArray(images)) {
    return null;
  }

  for (const image of images) {
    if (typeof image === 'string' && image.trim()) {
      return image;
    }
    if (
      image &&
      typeof image === 'object' &&
      'url' in image &&
      typeof image.url === 'string' &&
      image.url.trim()
    ) {
      return image.url;
    }
  }

  return null;
}

function toFiniteNonNegativeNumber(
  value: number | string | null | undefined
): number | null {
  const numericValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value.trim())
        : Number.NaN;

  return Number.isFinite(numericValue) && numericValue >= 0
    ? Math.round(numericValue)
    : null;
}
