import { toGoogleListingCondition } from '@baci/shared/lib';
import {
  type FeedImageManifestEntry,
  resolveGmcAdditionalImages,
  resolveGmcPrimaryImage,
} from '@/lib/gmc-feed-images';
import { escapeXml } from '@/lib/xml-utils';
import { buildFeedDescription } from './build-feed-description';
import {
  buildGoogleColorXml,
  buildGoogleProductDetailXml,
} from './build-product-detail-xml';
import type { FeedProduct, FeedVariant } from './feed-builder';
import { FEED_TITLE_MAX_LENGTH } from './feed-constants';
import { getFeedStockCount } from './feed-stock';

interface VariantFeedInput {
  product: FeedProduct;
  variants: FeedVariant[];
  manifest: FeedImageManifestEntry[];
  productUrl: string;
  currency: string;
  brand: string;
  platform: 'google' | 'facebook';
  familyRow?: boolean;
}

const text = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';
const color = (variant: FeedVariant) => {
  const attributes = Object.fromEntries(
    Object.entries(variant.attributes || {}).map(([key, value]) => [
      key.trim().toLowerCase(),
      value,
    ])
  );
  const name = text(attributes.color || attributes.colour).toLowerCase();
  const hex = text(attributes.color_hex).toLowerCase();
  return name ? `color:${name}` : hex ? `color_hex:${hex}` : '';
};

/** A row must describe one purchasable SKU, never a mixture of family fields. */
export function buildVariantFeedItems(input: VariantFeedInput): string {
  const { product, variants, manifest, productUrl, currency, brand, platform } =
    input;
  const colors = new Map(
    (product.variants || []).map((variant) => [variant.id, color(variant)])
  );
  return variants
    .map((variant) => {
      const condition = toGoogleListingCondition(variant.condition);
      const price = variant.price_override ?? variant.price ?? product.price;
      if (!variant.id || !condition || !Number.isFinite(price) || price <= 0)
        return '';

      let entries = manifest.filter((entry) => entry.variant_id === variant.id);
      if (!resolveGmcPrimaryImage(entries) && color(variant)) {
        entries = manifest.filter(
          (entry) =>
            entry.variant_id && colors.get(entry.variant_id) === color(variant)
        );
      }
      // A generic family image cannot prove the advertised colour.
      if (!resolveGmcPrimaryImage(entries) && !color(variant)) {
        entries = manifest.filter((entry) => !entry.variant_id);
      }
      const image = resolveGmcPrimaryImage(entries);
      if (!image) return '';

      const attributes = Object.fromEntries(
        Object.entries(variant.attributes || {})
          .filter(([, value]) => text(value))
          .map(([key, value]) => [key, text(value)])
      );
      const url = new URL(productUrl);
      url.searchParams.set('variantId', variant.id);
      url.searchParams.set(
        'condition',
        variant.condition === 'open_box' ? 'open_box' : condition
      );
      for (const key of Object.keys(attributes)
        .filter((key) => !['gtin', 'mpn'].includes(key))
        .sort())
        url.searchParams.set(key, attributes[key]);
      const stock = getFeedStockCount(product, variant);
      const availability = stock > 0 ? 'in_stock' : 'out_of_stock';
      const titleKeys = [
        'color',
        'storage',
        'size',
        'screen_size',
        'connectivity',
        'sim_type',
        'platform',
        'ram',
      ];
      const remainingKeys = Object.keys(attributes)
        .filter(
          (key) =>
            !titleKeys.includes(key) &&
            !['gtin', 'mpn', 'color_hex'].includes(key)
        )
        .sort();
      const title = [
        product.name,
        ...[...titleKeys, ...remainingKeys]
          .map((key) => attributes[key])
          .filter(Boolean),
        variant.condition === 'open_box'
          ? 'Open Box'
          : condition === 'refurbished'
            ? 'Refurbished'
            : condition === 'used'
              ? 'Used'
              : 'New',
      ].join(' - ');
      const maxTitle = FEED_TITLE_MAX_LENGTH;
      const boundedTitle =
        title.length > maxTitle
          ? `${title.slice(0, maxTitle - 3).trimEnd()}...`
          : title;
      const variantProduct = { ...product, variant_attributes: attributes };
      const compareAt = variant.compare_at_price;
      const prices =
        typeof compareAt === 'number' &&
        Number.isFinite(compareAt) &&
        compareAt > price
          ? `<g:price>${compareAt.toFixed(2)} ${currency}</g:price>\n<g:sale_price>${price.toFixed(2)} ${currency}</g:sale_price>`
          : `<g:price>${price.toFixed(2)} ${currency}</g:price>`;
      // Missing identifiers mean unknown, not that the manufacturer assigned none.
      const gtin = text(attributes.gtin);
      const mpn = text(attributes.mpn);
      return [
        '    <item>',
        `<g:id>${escapeXml(input.familyRow ? product.id : variant.id)}</g:id>`,
        input.familyRow
          ? ''
          : `<g:item_group_id>${escapeXml(product.id)}</g:item_group_id>`,
        `<g:title>${escapeXml(boundedTitle)}</g:title>`,
        `<g:description>${escapeXml(buildFeedDescription(variantProduct))}</g:description>`,
        `<g:link>${escapeXml(url.toString())}</g:link>`,
        `<g:canonical_link>${escapeXml(productUrl)}</g:canonical_link>`,
        `<g:image_link>${escapeXml(image)}</g:image_link>`,
        ...[...new Set(resolveGmcAdditionalImages(entries))]
          .filter((url) => url !== image)
          .map(
            (imageUrl) =>
              `<g:additional_image_link>${escapeXml(imageUrl)}</g:additional_image_link>`
          ),
        `<g:availability>${platform === 'facebook' ? availability.replaceAll('_', ' ') : availability}</g:availability>`,
        `<g:quantity>${stock}</g:quantity>`,
        prices,
        `<g:brand>${escapeXml(brand)}</g:brand>`,
        `<g:condition>${condition}</g:condition>`,
        gtin ? `<g:gtin>${escapeXml(gtin)}</g:gtin>` : '',
        mpn ? `<g:mpn>${escapeXml(mpn)}</g:mpn>` : '',
        gtin || mpn ? '<g:identifier_exists>yes</g:identifier_exists>' : '',
        buildGoogleColorXml(variantProduct),
        buildGoogleProductDetailXml(variantProduct),
        product.google_product_category
          ? `<g:google_product_category>${escapeXml(product.google_product_category)}</g:google_product_category>`
          : '',
        product.categories?.name || product.category
          ? `<g:product_type>${escapeXml(product.categories?.name || product.category || '')}</g:product_type>`
          : '',
        product.weight_value && product.weight_unit
          ? `<g:shipping_weight>${product.weight_value} ${product.weight_unit}</g:shipping_weight>`
          : '',
        '    </item>',
      ]
        .filter(Boolean)
        .map((line) => (line.startsWith('    <') ? line : `        ${line}`))
        .join('\n');
    })
    .filter(Boolean)
    .join('\n');
}
