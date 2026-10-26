import {
  getAllBrands,
  getAllCategories,
  getAttributeSet,
} from '@/lib/jumia/catalog';
import type { JumiaClient } from '@/lib/jumia/client';
import { jumiaProductPreflightSelectionPageSchema } from '@/schemas/jumia/product-preflight-selection-page';

export type ProductPreflightRpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>
  ) => PromiseLike<{
    data: unknown;
    error: { code?: string } | null;
  }>;
};

export type ProductPreflightPageInput = {
  merchantId: string;
  selectionId: string;
  sourceCategoryId: string;
  sourcePage: { page: number; limit: number };
  products: readonly { productId: string; sourceVersion: string }[];
};

export type ProductPreflightMappingMetadataInput = {
  productId: string;
  category: { code: number; name: string };
  brand: { code: number; name: string };
  attributeSetId: string;
};

export type ProductPreflightMappingMetadata = {
  productId: string;
  category: Awaited<ReturnType<typeof getAllCategories>>[number];
  brand: Awaited<ReturnType<typeof getAllBrands>>[number];
  attributes: Awaited<ReturnType<typeof getAttributeSet>>['attributes'];
};

export type ProductPreflightMetadataResult =
  | {
      success: false;
      code: 'metadata_unavailable' | 'mapping_metadata_missing';
    }
  | { success: true; mappings: ProductPreflightMappingMetadata[] };

/** Fetch current provider metadata only through the already-selected integration. */
export async function loadProductPreflightMetadata(
  client: JumiaClient,
  mappings: readonly ProductPreflightMappingMetadataInput[]
): Promise<ProductPreflightMetadataResult> {
  const attributeSetIds = [
    ...new Set(mappings.map((item) => item.attributeSetId)),
  ];
  let categories: Awaited<ReturnType<typeof getAllCategories>>;
  let brands: Awaited<ReturnType<typeof getAllBrands>>;
  let attributeSets: Awaited<ReturnType<typeof getAttributeSet>>[];
  try {
    [categories, brands, attributeSets] = await Promise.all([
      getAllCategories(client),
      getAllBrands(client),
      Promise.all(attributeSetIds.map((id) => getAttributeSet(client, id))),
    ]);
  } catch {
    return { success: false, code: 'metadata_unavailable' };
  }

  const resolved = mappings.map((mapping) => {
    const category = categories.filter(
      (item) =>
        item.code === mapping.category.code &&
        item.name === mapping.category.name &&
        item.attributeSet.sid === mapping.attributeSetId
    );
    const brand = brands.filter(
      (item) =>
        item.code === mapping.brand.code && item.name === mapping.brand.name
    );
    const attributeSetIndex = attributeSetIds.indexOf(mapping.attributeSetId);
    if (category.length !== 1 || brand.length !== 1 || attributeSetIndex < 0)
      return null;
    return {
      productId: mapping.productId,
      category: category[0],
      brand: brand[0],
      attributes: attributeSets[attributeSetIndex].attributes,
    };
  });
  if (resolved.some((item) => item === null))
    return { success: false, code: 'mapping_metadata_missing' };
  return {
    success: true,
    mappings: resolved.filter(
      (item): item is NonNullable<typeof item> => item !== null
    ),
  };
}

export type ProductPreflightPageResult =
  | {
      success: false;
      code:
        | 'source_unavailable'
        | 'selection_mismatch'
        | 'source_stale'
        | 'selection_page_inconsistent';
    }
  | {
      success: true;
      products: {
        productId: string;
        sourceVersion: string;
        projection: Record<string, unknown>;
      }[];
    };

/** One authorized bounded page read; caller-provided page is only a locator, never proof. */
export async function loadProductPreflightPage(
  client: ProductPreflightRpcClient,
  input: ProductPreflightPageInput
): Promise<ProductPreflightPageResult> {
  const { data, error } = await client.rpc(
    'get_jumia_product_export_selection_page_for_merchant',
    {
      p_selection_id: input.selectionId,
      p_merchant_id: input.merchantId,
      p_page: input.sourcePage.page,
      p_limit: input.sourcePage.limit,
    }
  );
  if (error || !data) return { success: false, code: 'source_unavailable' };
  const parsed = jumiaProductPreflightSelectionPageSchema.safeParse(data);
  if (!parsed.success)
    return { success: false, code: 'selection_page_inconsistent' };
  const page = parsed.data;
  if (
    page.selectionId !== input.selectionId ||
    page.sourceCategoryId !== input.sourceCategoryId ||
    page.page !== input.sourcePage.page ||
    page.limit !== input.sourcePage.limit ||
    page.products.length > input.sourcePage.limit
  )
    return { success: false, code: 'selection_mismatch' };
  const requested = new Map(
    input.products.map(({ productId, sourceVersion }) => [
      productId,
      sourceVersion,
    ])
  );
  const items = new Map(page.products.map((item) => [item.id, item]));
  if (
    items.size !== page.products.length ||
    [...requested.keys()].some((productId) => !items.has(productId))
  )
    return { success: false, code: 'selection_mismatch' };
  const output: {
    productId: string;
    sourceVersion: string;
    projection: Record<string, unknown>;
  }[] = [];
  for (const [productId, sourceVersion] of requested) {
    const item = items.get(productId);
    if (
      !item?.available ||
      !item.product ||
      item.capturedSourceVersion !== sourceVersion ||
      item.currentSourceVersion !== sourceVersion
    )
      return { success: false, code: 'source_stale' };
    if (
      !item.product ||
      typeof item.product !== 'object' ||
      Array.isArray(item.product)
    )
      return { success: false, code: 'selection_page_inconsistent' };
    output.push({
      productId,
      sourceVersion,
      projection: item.product as Record<string, unknown>,
    });
  }
  return { success: true, products: output };
}
