import {
  resolveGmcAdditionalImages,
  resolveGmcPrimaryImage,
} from '@/lib/gmc-feed-images';
import { collectOfferClaimedImageUrls } from '@/lib/gmc-offer-claimed-images';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { stripHtmlTags } from '@/lib/sanitize-core';
import {
  coerceStorefrontManageStock,
  getStorefrontAgentAvailability,
} from '@/lib/storefront-agent-availability';
import { buildAgentProductUrl } from '@/lib/storefront-agent-urls';
import type { ImageManifestMap } from '../google-merchant/feed-builder';
import { PRODUCT_DESCRIPTION_MAX_LENGTH } from './feed-constants';
import type { OpenAIFeedVariant } from './feed-data';
import type { CurrentOpenAIFeedItem, Merchant, Product } from './feed-types';

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function getOpenAIFeedImageUrls(
  product: Product,
  imageManifest: ImageManifestMap
): string[] {
  const manifestEntries = imageManifest[product.id] || [];
  const offerClaimedImageUrls = collectOfferClaimedImageUrls(product.offers);
  const manifestPrimaryImage = resolveGmcPrimaryImage(
    manifestEntries,
    offerClaimedImageUrls
  );
  if (manifestPrimaryImage) {
    return [
      manifestPrimaryImage,
      ...resolveGmcAdditionalImages(manifestEntries, offerClaimedImageUrls),
    ];
  }

  return (
    product.images
      ?.map((image) => (typeof image === 'string' ? image : image.url))
      .filter(isString) || []
  );
}

function getCurrentFeedCategoryValue(product: Product): string {
  return product.category || product.google_product_category || 'Products';
}

function buildCurrentFeedVariantTitle(
  product: Product,
  variant: OpenAIFeedVariant
): string {
  const titleParts = [product.name];
  const color = variant.attributes?.color || variant.attributes?.Color;
  const size = variant.attributes?.size || variant.attributes?.Size;
  const storage = variant.attributes?.storage || variant.attributes?.Storage;

  if (color) titleParts.push(color);
  if (size) titleParts.push(size);
  if (storage) titleParts.push(storage);

  return titleParts.join(' - ');
}

function buildCurrentFeedVariants(
  product: Product,
  url: string,
  currency: string,
  productAvailability: ReturnType<typeof getStorefrontAgentAvailability>
): CurrentOpenAIFeedItem['variants'] {
  if (!product.variants?.length) {
    return [
      {
        id: product.sku || product.id,
        title: product.name,
        url,
        price: { amount: product.price, currency },
        list_price:
          product.compare_at_price && product.compare_at_price > product.price
            ? { amount: product.compare_at_price, currency }
            : undefined,
        availability: {
          available: productAvailability.is_purchasable,
          status: productAvailability.availability,
          quantity: productAvailability.quantity_available,
        },
        condition: [product.condition || 'new'],
        categories: [
          {
            value: getCurrentFeedCategoryValue(product),
            taxonomy: 'merchant',
          },
        ],
      },
    ];
  }

  return product.variants.flatMap((variant) => {
    const price = variant.price_override ?? product.price;
    if (price <= 0) {
      return [];
    }

    const availability = getStorefrontAgentAvailability({
      manage_stock: coerceStorefrontManageStock(product.manage_stock),
      stock_quantity: variant.stock_quantity,
    });

    return [
      {
        id: variant.sku || variant.id,
        title: buildCurrentFeedVariantTitle(product, variant),
        url,
        price: { amount: price, currency },
        list_price:
          product.compare_at_price && product.compare_at_price > price
            ? { amount: product.compare_at_price, currency }
            : undefined,
        availability: {
          available: availability.is_purchasable,
          status: availability.availability,
          quantity: availability.quantity_available,
        },
        condition: [product.condition || 'new'],
        categories: [
          {
            value: getCurrentFeedCategoryValue(product),
            taxonomy: 'merchant',
          },
        ],
      },
    ];
  });
}

function hasCurrentFeedOffer(product: Product): boolean {
  if (product.variants?.length) {
    return product.variants.some(
      (variant) => (variant.price_override ?? product.price) > 0
    );
  }

  return product.price > 0;
}

export function generateCurrentOpenAIProductFeed(
  products: Product[],
  merchant: Merchant,
  baseUrl: string,
  imageManifest: ImageManifestMap = {}
): string[] {
  const currency = resolveMerchantCurrencyConfig(merchant).code;

  return products
    .filter((product) => {
      if (!product.name || product.name.trim().length === 0) {
        return false;
      }

      return hasCurrentFeedOffer(product);
    })
    .map((product) => {
      const url = buildAgentProductUrl({ baseUrl, product });
      const availability = getStorefrontAgentAvailability({
        manage_stock: coerceStorefrontManageStock(product.manage_stock),
        stock: product.stock,
        stock_quantity: product.stock_quantity,
      });
      const imageUrls = getOpenAIFeedImageUrls(product, imageManifest);

      const item: CurrentOpenAIFeedItem = {
        id: product.id,
        title: product.name,
        description: {
          plain: stripHtmlTags(product.description || '')
            .trim()
            .slice(0, PRODUCT_DESCRIPTION_MAX_LENGTH),
        },
        url,
        media: imageUrls.map((url) => ({ type: 'image', url })),
        variants: buildCurrentFeedVariants(
          product,
          url,
          currency,
          availability
        ),
      };

      return JSON.stringify(item);
    });
}
