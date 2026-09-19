export const RELATED_BLOG_PRODUCTS_SELECT =
  'id, name, slug, price, compare_at_price, min_variant_price, max_variant_price, stock, stock_quantity, manage_stock, has_condition_offers, has_variants, categories:category_id!inner(slug)' as const;

export const RELATED_BLOG_PRODUCT_LINKS_SELECT =
  'relationship, product:products!blog_post_products_product_id_fkey(id, name, slug, status, price, compare_at_price, min_variant_price, max_variant_price, stock, stock_quantity, manage_stock, has_condition_offers, has_variants, categories:category_id(slug))' as const;

export interface RelatedBlogProductVariant {
  id?: string;
  inventory_tracking_policy?: string | null;
  price_override?: number | null;
  stock_quantity?: number | null;
}

export interface RelatedBlogProductOffer {
  compare_at_price?: number | null;
  price?: number | null;
  status?: string | null;
  stock_quantity?: number | null;
}

interface RelatedBlogProductCategory {
  slug: string | null;
}

interface RelatedBlogProductRow {
  compare_at_price?: number | null;
  has_condition_offers?: boolean | null;
  has_variants?: boolean | null;
  id: string;
  name: string;
  manage_stock?: boolean | null;
  max_variant_price?: number | null;
  min_variant_price?: number | null;
  price?: number | null;
  slug: string;
  stock?: number | null;
  stock_quantity?: number | null;
  status?: string | null;
  categories?: RelatedBlogProductCategory | RelatedBlogProductCategory[] | null;
}

interface RelatedBlogProductLinkRow {
  product?: RelatedBlogProductRow | RelatedBlogProductRow[] | null;
}

export interface RelatedBlogProduct {
  compare_at_price?: number | null;
  has_condition_offers?: boolean | null;
  has_variants?: boolean | null;
  id: string;
  name: string;
  manage_stock?: boolean | null;
  max_variant_price?: number | null;
  min_variant_price?: number | null;
  offers?: RelatedBlogProductOffer[];
  price?: number | null;
  slug: string;
  stock?: number | null;
  stock_quantity?: number | null;
  /** True when an active condition offer has confirmed available stock. */
  has_purchasable_condition_offer?: boolean;
  /** True when a public product variant has confirmed available stock. */
  has_purchasable_variant?: boolean;
  inventory_tracking_policy?: string | null;
  variants?: RelatedBlogProductVariant[];
  category_slug: string | null;
}

export function normalizeRelatedBlogProducts(
  products: RelatedBlogProductRow[] | null | undefined
): RelatedBlogProduct[] {
  return (products ?? []).map(({ categories, status: _status, ...product }) => {
    const category = Array.isArray(categories) ? categories[0] : categories;

    return {
      ...product,
      category_slug: category?.slug ?? null,
    };
  });
}

export function normalizeRelatedBlogProductLinks(
  links: RelatedBlogProductLinkRow[] | null | undefined
): RelatedBlogProduct[] {
  const products = (links ?? []).flatMap((link) => {
    const product = Array.isArray(link.product)
      ? link.product[0]
      : link.product;

    if (product?.status !== 'active') {
      return [];
    }

    return [product];
  });

  return normalizeRelatedBlogProducts(products);
}
