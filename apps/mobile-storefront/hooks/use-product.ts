import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import {
  buildProductQueryKey,
  CONSTANT_MERCHANT_ID,
  log,
  normalizeProductVariants,
  type ProductsPage,
  resolveAndEvictProduct,
  transformProduct,
} from '@/hooks/product-utils';
import { useMerchant } from '@/hooks/use-merchant';
import { resolveProductVariantMetadata } from '@/lib/product-variant-metadata';
import { ProductRowSchema } from '@/lib/validation';
import type { Product } from '@/types/product';
import { isVariantBearingProduct } from './product-variant-state';

function hasVariantAttributeValues(
  variantAttributes: Record<string, string[]> | undefined
) {
  return Object.values(variantAttributes ?? {}).some(
    (values) => values.length > 0
  );
}

export function augmentProduct(
  item: z.infer<typeof ProductRowSchema>
): Product {
  const baseProduct = transformProduct(item);
  if (!baseProduct) {
    throw new Error('Product transformation failed for validated row');
  }

  const variants = normalizeProductVariants(item.variants, {
    basePrice: baseProduct.price,
    compareAtPrice: baseProduct.compare_at_price,
  });
  const variantMetadata = resolveProductVariantMetadata({
    colorImages: baseProduct.color_images,
    productImages: baseProduct.images,
    productColors: baseProduct.colors,
    sourceVariantAttributes: item.variant_attributes,
    variants,
  });

  return {
    ...baseProduct,
    colors: variantMetadata.colors ?? baseProduct.colors,
    has_variants: isVariantBearingProduct(item),
    color_images: variantMetadata.colorImages ?? baseProduct.color_images,
    images:
      variantMetadata.galleryImages && variantMetadata.galleryImages.length > 0
        ? variantMetadata.galleryImages
        : baseProduct.images,
    variant_attributes: hasVariantAttributeValues(
      variantMetadata.variantAttributes
    )
      ? variantMetadata.variantAttributes
      : baseProduct.variant_attributes,
    variants,
  };
}

export function useProduct(slug: string) {
  const queryClient = useQueryClient();
  const { data: merchant } = useMerchant();
  const merchantId = merchant?.id || CONSTANT_MERCHANT_ID;

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: buildProductQueryKey(slug, merchantId),
    queryFn: async () => {
      log.info('Fetching product:', slug);
      const data = await resolveAndEvictProduct(merchantId, slug, queryClient);

      const validated = ProductRowSchema.safeParse(data);
      if (!validated.success) {
        log.error('Product validation failed:', validated.error.format());
        throw new Error(
          `Product validation failed: ${validated.error.message}`
        );
      }

      const item = validated.data;

      return augmentProduct(item);
    },
    enabled: !!slug && !!merchantId,
    staleTime: 1000 * 60 * 5,
    refetchOnMount: true,
    initialDataUpdatedAt: 0,
    initialData: () => {
      const productsCaches = queryClient.getQueriesData<{
        pages: ProductsPage[];
      }>({ queryKey: ['products', merchantId] });

      const allPages = productsCaches.flatMap(([, cache]) =>
        cache && Array.isArray(cache.pages) ? cache.pages : []
      );

      for (const page of allPages) {
        const found = page.products.find((product) => product.slug === slug);
        if (found) {
          if (isVariantBearingProduct(found)) {
            return undefined;
          }

          const compareAtPrice = found.compare_at_price;
          const basePrice = found.price;
          const variants = normalizeProductVariants(found.variants || [], {
            basePrice,
            compareAtPrice,
          });
          const variantMetadata = resolveProductVariantMetadata({
            colorImages: found.color_images,
            productImages: found.images,
            productColors: found.colors,
            sourceVariantAttributes: found.variant_attributes,
            variants,
          });

          return {
            ...found,
            colors: variantMetadata.colors ?? found.colors,
            has_variants: found.has_variants || false,
            color_images: variantMetadata.colorImages ?? found.color_images,
            images:
              variantMetadata.galleryImages &&
              variantMetadata.galleryImages.length > 0
                ? variantMetadata.galleryImages
                : found.images,
            variant_attributes: hasVariantAttributeValues(
              variantMetadata.variantAttributes
            )
              ? variantMetadata.variantAttributes
              : found.variant_attributes,
            variants,
          };
        }
      }

      return undefined;
    },
  });

  return {
    product: data || null,
    isLoading,
    error: error?.message || null,
    refetch,
  };
}

export function usePrefetchProduct() {
  const queryClient = useQueryClient();
  const { data: merchant } = useMerchant();
  const merchantId = merchant?.id || CONSTANT_MERCHANT_ID;

  return (slug: string) => {
    if (!merchantId) return Promise.resolve();
    return queryClient.prefetchQuery({
      queryKey: buildProductQueryKey(slug, merchantId),
      queryFn: async () => {
        const data = await resolveAndEvictProduct(
          merchantId,
          slug,
          queryClient
        );

        const validated = ProductRowSchema.safeParse(data);
        if (!validated.success) {
          log.error(
            'Prefetch product validation failed:',
            validated.error.format()
          );
          throw new Error(
            `Product validation failed: ${validated.error.message}`
          );
        }

        return augmentProduct(validated.data);
      },
    });
  };
}
