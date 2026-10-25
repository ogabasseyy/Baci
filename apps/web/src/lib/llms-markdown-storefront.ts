import type { CachedMerchant } from '@/lib/cached-data';
import { sanitizeMarkdownText } from '@/lib/llms-markdown-sanitize';
import {
  getStorefrontFaqItems,
  type StorefrontFaqSource,
} from '@/lib/llms-markdown-storefront-faq';
import { normalizeOrigin } from '@/lib/normalize-origin';
import { normalizeProduct, type RawDbProduct } from '@/lib/normalize-product';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import {
  coerceStorefrontManageStock,
  getStorefrontAgentAvailability,
} from '@/lib/storefront-agent-availability';
import { buildAgentProductUrl } from '@/lib/storefront-agent-urls';
import type { MerchantAboutPage } from '@/types/about-page';

const MAX_PRODUCTS_IN_CATEGORY_MARKDOWN = 24;

function buildMerchantIntro(
  merchant: StorefrontFaqSource,
  origin: string
): string[] {
  const description =
    merchant.site_description ||
    merchant.site_tagline ||
    `Storefront for ${merchant.business_name}.`;
  const businessName = sanitizeMarkdownText(merchant.business_name);
  const safeDescription = sanitizeMarkdownText(description);
  const businessType = sanitizeMarkdownText(
    merchant.business_type || 'Not specified'
  );
  const phone = sanitizeMarkdownText(merchant.phone);
  const email = sanitizeMarkdownText(merchant.email);

  return [
    `# ${businessName}`,
    '',
    `> ${safeDescription}`,
    '',
    '## Storefront Summary',
    `- Business type: ${businessType}`,
    `- Canonical host: ${origin}`,
    phone ? `- Phone: ${phone}` : '',
    email ? `- Email: ${email}` : '',
    '',
  ].filter(Boolean);
}

function getProductMarkdownMirrorUrl(productUrl: string): string {
  return `${productUrl.replace(/\/+$/, '')}.md`;
}

function isRawDbProduct(product: unknown): product is RawDbProduct {
  return (
    product !== null &&
    typeof product === 'object' &&
    typeof (product as RawDbProduct).id === 'string' &&
    typeof (product as RawDbProduct).name === 'string' &&
    typeof (product as RawDbProduct).price === 'number'
  );
}

export function buildStorefrontHomeMarkdown(
  merchant: StorefrontFaqSource,
  origin: string
): string {
  const normalizedOrigin = normalizeOrigin(origin);

  return [
    ...buildMerchantIntro(merchant, normalizedOrigin),
    '## Primary Routes',
    `- ${normalizedOrigin}/sitemap.xml`,
    `- ${normalizedOrigin}/cart`,
    `- ${normalizedOrigin}/checkout`,
    `- ${normalizedOrigin}/track-order`,
    merchant.pages?.about || merchant.about_page
      ? `- ${normalizedOrigin}/about`
      : '',
    merchant.pages?.contact || merchant.email || merchant.phone
      ? `- ${normalizedOrigin}/contact`
      : '',
    getStorefrontFaqItems(merchant).length > 0
      ? `- ${normalizedOrigin}/faq`
      : '',
    '',
    '## Route Patterns',
    `- ${normalizedOrigin}/{category}`,
    `- ${normalizedOrigin}/{category}/index.html.md`,
    `- ${normalizedOrigin}/{category}/{productSlug}`,
    `- ${normalizedOrigin}/{category}/{productSlug}.md`,
    `- ${normalizedOrigin}/products/{productSlug}`,
    `- ${normalizedOrigin}/blog/index.html.md`,
    `- ${normalizedOrigin}/blog/{postSlug}.md`,
    '- `/{category}/brands/{brandSlug}`: Brand authority hub with curated model families, price bands, and comparisons',
    '- `/{category}/brands/{brandSlug}/families/{familySlug}`: Model family authority hub for a specific product generation',
    '- `/{category}/compare/{comparisonSlug}`: Side-by-side product or brand comparison page with structured specs',
    '- `/{category}/best-under/{priceBandSlug}`: Budget-segmented buying guide and product rankings',
    '',
    '## Notes',
    '- `/checkout`, `/account`, and wallet or payment flows are stateful.',
    '- Prefer sitemap and product/category pages for public catalog discovery.',
    '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildStorefrontAboutMarkdown(
  merchant: CachedMerchant,
  origin: string
): string {
  const normalizedOrigin = normalizeOrigin(origin);
  const aboutPage: Partial<MerchantAboutPage> = merchant.about_page || {};
  const values =
    aboutPage.values && aboutPage.values.length > 0
      ? aboutPage.values.map((value) => `- ${sanitizeMarkdownText(value)}`)
      : [];

  return [
    ...buildMerchantIntro(merchant, normalizedOrigin),
    '# About',
    '',
    sanitizeMarkdownText(
      aboutPage.story ||
        merchant.pages?.about ||
        `About ${merchant.business_name}`
    ),
    '',
    aboutPage.mission
      ? `## Mission\n${sanitizeMarkdownText(aboutPage.mission)}\n`
      : '',
    aboutPage.vision
      ? `## Vision\n${sanitizeMarkdownText(aboutPage.vision)}\n`
      : '',
    values.length > 0 ? '## Values' : '',
    ...values,
    '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildStorefrontContactMarkdown(
  merchant: CachedMerchant,
  origin: string
): string {
  const normalizedOrigin = normalizeOrigin(origin);
  const contactText = sanitizeMarkdownText(
    merchant.pages?.contact || `Contact ${merchant.business_name}.`
  );
  const phone = sanitizeMarkdownText(merchant.phone);
  const email = sanitizeMarkdownText(merchant.email);
  const address = sanitizeMarkdownText(merchant.business_address);

  return [
    ...buildMerchantIntro(merchant, normalizedOrigin),
    '# Contact',
    '',
    contactText,
    '',
    '## Contact Details',
    phone ? `- Phone: ${phone}` : '',
    email ? `- Email: ${email}` : '',
    address ? `- Address: ${address}` : '',
    '',
    `- Contact page: ${normalizedOrigin}/contact`,
    '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildStorefrontFaqMarkdown(
  merchant: StorefrontFaqSource,
  origin: string
): string {
  const normalizedOrigin = normalizeOrigin(origin);
  const faqItems = getStorefrontFaqItems(merchant);

  return [
    ...buildMerchantIntro(merchant, normalizedOrigin),
    '# FAQ',
    '',
    ...faqItems.flatMap((item) => [
      `## ${sanitizeMarkdownText(item.question)}`,
      '',
      sanitizeMarkdownText(item.answer),
      '',
    ]),
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildCategoryMarkdown(
  merchant: CachedMerchant,
  origin: string,
  categorySlug: string,
  data: {
    isCollection: boolean;
    name?: string;
    fallbackName?: string;
    fallbackDescription?: string;
    products: unknown[];
  }
): string {
  const normalizedOrigin = normalizeOrigin(origin);
  const title = data.isCollection
    ? data.name || categorySlug
    : data.fallbackName || categorySlug;
  const description =
    data.fallbackDescription ||
    `Browse ${title} from ${merchant.business_name}.`;
  const safeTitle = sanitizeMarkdownText(title);
  const safeDescription = sanitizeMarkdownText(description);
  const businessName = sanitizeMarkdownText(merchant.business_name);
  const merchantCurrency = sanitizeMarkdownText(
    resolveMerchantCurrencyConfig(merchant).code
  );
  // Only the first MAX_PRODUCTS_IN_CATEGORY_MARKDOWN products are rendered, so
  // normalize just those — normalizeProduct (image extraction, category lookup,
  // slug/spec normalization) over the full uncapped category list was wasted
  // work on this uncached per-request markdown build. The displayed count still
  // reflects the full eligible set.
  const eligibleProducts = data.products.filter(isRawDbProduct);
  const products = eligibleProducts
    .slice(0, MAX_PRODUCTS_IN_CATEGORY_MARKDOWN)
    .map((product) => normalizeProduct(product));

  return [
    `# ${safeTitle}`,
    '',
    `> ${safeDescription}`,
    '',
    `- Store: ${businessName}`,
    `- Canonical category URL: ${normalizedOrigin}/${categorySlug}`,
    `- Markdown mirror: ${normalizedOrigin}/${categorySlug}/index.html.md`,
    `- Product count in this view: ${eligibleProducts.length}`,
    '',
    '## Products',
    ...products.flatMap((product) => {
      const productUrl = buildAgentProductUrl({
        baseUrl: normalizedOrigin,
        product,
      });

      return [
        `- [${sanitizeMarkdownText(product.name)}](${getProductMarkdownMirrorUrl(productUrl)}): ${product.price} ${merchantCurrency}${product.brand ? `, ${sanitizeMarkdownText(product.brand)}` : ''}`,
      ];
    }),
    '',
  ].join('\n');
}

const KEY_SPEC_FIELDS: ReadonlyArray<{
  keys: readonly string[];
  label: string;
  suffix?: string;
}> = [
  { keys: ['chipset', 'processor'], label: 'Processor' },
  { keys: ['ram_gb'], label: 'RAM', suffix: 'GB' },
  { keys: ['storage_gb'], label: 'Storage', suffix: 'GB' },
  {
    keys: ['screen_size_inches', 'display_size_inches'],
    label: 'Display Size',
    suffix: ' inches',
  },
  { keys: ['display_type'], label: 'Display Type' },
  { keys: ['battery_mah'], label: 'Battery', suffix: 'mAh' },
  { keys: ['main_camera_mp'], label: 'Main Camera', suffix: 'MP' },
  { keys: ['front_camera_mp'], label: 'Front Camera', suffix: 'MP' },
  { keys: ['gpu'], label: 'Graphics' },
  { keys: ['android_version', 'os'], label: 'Operating System' },
  { keys: ['network_technology', 'network'], label: 'Network' },
  { keys: ['sim_type'], label: 'SIM' },
  { keys: ['warranty'], label: 'Warranty' },
];

function isNumericSpec(value: unknown): boolean {
  if (typeof value === 'number') return !Number.isNaN(value);
  if (typeof value === 'string') return /^-?\d+(\.\d+)?$/.test(value.trim());
  return false;
}

export function buildProductMarkdown(
  merchant: CachedMerchant,
  origin: string,
  rawProduct: RawDbProduct
): string {
  const normalizedOrigin = normalizeOrigin(origin);
  const product = normalizeProduct(rawProduct);
  const productUrl = buildAgentProductUrl({
    baseUrl: normalizedOrigin,
    product,
  });
  const agentAvailability = getStorefrontAgentAvailability({
    manage_stock: coerceStorefrontManageStock(rawProduct.manage_stock),
    stock: rawProduct.stock,
    stock_quantity: rawProduct.stock_quantity,
    low_stock_threshold: rawProduct.low_stock_threshold,
  });
  const currency = sanitizeMarkdownText(
    resolveMerchantCurrencyConfig(merchant).code
  );
  const compareAt =
    product.compare_at_price && product.compare_at_price > product.price
      ? `- Compare at price: ${product.compare_at_price} ${currency}`
      : '';
  const description = product.description || `Buy ${product.name}.`;
  const productName = sanitizeMarkdownText(product.name);
  const safeDescription = sanitizeMarkdownText(description);
  const businessName = sanitizeMarkdownText(merchant.business_name);
  const category = sanitizeMarkdownText(product.category);
  const brand = sanitizeMarkdownText(product.brand);
  const condition = sanitizeMarkdownText(product.condition);
  const primaryImage = product.images[0]
    ? sanitizeMarkdownText(product.images[0])
    : '';

  const specs = product.product_key_specs as
    | Record<string, unknown>
    | null
    | undefined;
  const specBullets: string[] = [];
  if (specs && typeof specs === 'object') {
    for (const { keys, label, suffix } of KEY_SPEC_FIELDS) {
      const rawVal = keys
        .map((key) => specs[key])
        .find(
          (val) =>
            val !== null && val !== undefined && String(val).trim() !== ''
        );
      if (rawVal === null || rawVal === undefined) continue;
      const strVal = String(rawVal).trim();
      if (!strVal) continue;

      let formattedValue: string;
      if (suffix && isNumericSpec(rawVal)) {
        const numStr = typeof rawVal === 'number' ? String(rawVal) : strVal;
        formattedValue = `${numStr}${suffix}`;
      } else {
        formattedValue = strVal;
      }

      specBullets.push(`- ${label}: ${sanitizeMarkdownText(formattedValue)}`);
    }
  }

  const keySpecsSection =
    specBullets.length > 0 ? ['## Key Specifications', ...specBullets, ''] : [];

  return [
    `# ${productName}`,
    '',
    `> ${safeDescription}`,
    '',
    ...keySpecsSection,
    '## Summary',
    `- Store: ${businessName}`,
    `- Category: ${category}`,
    brand ? `- Brand: ${brand}` : '',
    `- Price: ${product.price} ${currency}`,
    compareAt,
    `- Condition: ${condition}`,
    `- Availability: ${agentAvailability.availability}`,
    `- inventory_policy: ${agentAvailability.inventory_policy}`,
    `- is_purchasable: ${String(agentAvailability.is_purchasable)}`,
    `- quantity_available: ${agentAvailability.quantity_available ?? 'untracked'}`,
    `- Canonical product URL: ${productUrl}`,
    `- Markdown mirror: ${getProductMarkdownMirrorUrl(productUrl)}`,
    primaryImage ? `- Primary image: ${primaryImage}` : '',
    '',
  ]
    .filter(Boolean)
    .join('\n');
}
