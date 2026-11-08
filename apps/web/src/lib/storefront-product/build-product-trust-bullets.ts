import { formatCurrencyCompact } from '@/lib/currency';
import { getCuratedPriceBands } from '@/lib/storefront-compare/price-band-taxonomy';
import type { BuildProductSemanticModelInput } from './product-semantic-types';

function toTitleCase(value: string) {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function buildPriceBandLabel(
  input: BuildProductSemanticModelInput,
  ceiling: number
) {
  return `Best ${input.categoryName} Under ${formatCurrencyCompact(
    ceiling,
    input.countryCode || 'NG'
  )}`;
}

const SPEC_FORMATTERS: [string, (value: string | number) => string][] = [
  ['ram_gb', (v) => `${v}GB RAM`],
  ['storage_gb', (v) => `${v}GB storage`],
  ['battery_mah', (v) => `${v}mAh battery`],
  ['main_camera_mp', (v) => `${v}MP camera`],
];

function getPositiveSpecNumber(raw: unknown): string | number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed && /^\d+(\.\d+)?$/.test(trimmed)) {
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) && parsed > 0 ? trimmed : null;
    }
  }
  return null;
}

function formatKeySpecsBullet(
  specs?: Record<string, unknown> | null
): string | null {
  if (!specs) return null;

  const parts = SPEC_FORMATTERS.map(([key, format]) => {
    const val = getPositiveSpecNumber(specs[key]);
    return val !== null ? format(val) : null;
  }).filter((part): part is string => Boolean(part));

  return parts.length > 0 ? `Key specs: ${parts.slice(0, 3).join(', ')}` : null;
}

export function buildProductTrustBullets(
  input: BuildProductSemanticModelInput
): string[] {
  const bullets: string[] = [];

  if (input.currentProduct.condition) {
    bullets.push(
      `Available in ${toTitleCase(input.currentProduct.condition)} condition`
    );
  }

  const containingBand = getCuratedPriceBands(input.categorySlug, {
    merchantCurrency: input.merchantCurrency,
  }).find(
    (band) =>
      input.currentProduct.price <= band.ceiling &&
      (band.floor ? input.currentProduct.price > band.floor : true)
  );

  if (containingBand) {
    bullets.push(
      `Listed in ${buildPriceBandLabel(input, containingBand.ceiling)}`
    );
  }

  if (
    input.currentProduct.stock !== undefined &&
    input.currentProduct.stock !== null
  ) {
    bullets.push(
      input.currentProduct.stock > 0
        ? 'In stock for immediate dispatch'
        : 'Currently out of stock'
    );
  }

  const specsBullet = formatKeySpecsBullet(
    input.currentProduct.product_key_specs
  );
  if (specsBullet) {
    bullets.push(specsBullet);
  }

  return bullets;
}
