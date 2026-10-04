import { isStorefrontProductVariantPublic } from '@/lib/is-storefront-product-variant-public';
import type {
  SavingsDeviceProduct,
  SavingsDeviceVariant,
} from '@/schemas/customer-savings-device';

export {
  type SavingsDeviceProduct,
  SavingsDeviceProductSchema,
  type SavingsDeviceVariant,
  SavingsDeviceVariantSchema,
} from '@/schemas/customer-savings-device';
export {
  asSavingsDeviceQueryClient,
  readSavingsDeviceProduct,
  SAVINGS_DEVICE_PRODUCT_SELECT,
  type SavingsDeviceQueryClient,
} from './customer-savings-device-reader';

export type SavingsDeviceSnapshot = {
  condition: string | null;
  image: string | null;
  name: string;
  price: number;
  selectionStatus: 'exact';
  variantId: string | null;
  variantLabel: string | null;
};

export type SavingsDeviceResolution =
  | {
      cataloguePrice: number;
      ok: true;
      snapshot: SavingsDeviceSnapshot;
      targetAmount: number;
      variant: SavingsDeviceVariant | null;
      variantId: string | null;
    }
  | { code: string; error: string; ok: false; status: 400 | 404 | 409 };

function formatVariantAxisLabel(axis: string) {
  const normalized = axis
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const labels: Record<string, string> = {
    ram: 'RAM',
    rom: 'ROM',
    sim_type: 'SIM Type',
    storage: 'Storage',
  };

  return (
    labels[normalized] ??
    normalized
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  );
}

function getVariantLabel(variant: SavingsDeviceVariant | null) {
  if (!variant) {
    return null;
  }

  const parts = Object.entries(variant.attributes ?? {})
    .filter(([, value]) => value)
    .map(([axis, value]) => `${formatVariantAxisLabel(axis)}: ${value}`);

  return parts.length > 0 ? parts.join(' · ') : variant.sku?.trim() || null;
}

function toPositiveAmount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getProductImage(
  product: SavingsDeviceProduct,
  variant: SavingsDeviceVariant | null
) {
  const variantImage =
    variant?.primary_image?.trim() || variant?.images?.[0]?.trim();
  return variantImage || product.images?.[0]?.trim() || null;
}

function buildProductSnapshot({
  product,
  targetAmount,
  variant,
}: {
  product: SavingsDeviceProduct;
  targetAmount: number;
  variant: SavingsDeviceVariant | null;
}): SavingsDeviceSnapshot {
  return {
    condition: variant?.condition ?? product.condition ?? null,
    image: getProductImage(product, variant),
    name: product.name,
    price: targetAmount,
    selectionStatus: 'exact',
    variantId: variant?.id ?? null,
    variantLabel: getVariantLabel(variant),
  };
}

export function resolveSavingsDeviceSelection({
  clientTargetAmount,
  product,
  variantId,
}: {
  clientTargetAmount?: number;
  product: SavingsDeviceProduct;
  variantId?: string | null;
}): SavingsDeviceResolution {
  // Same public-visibility rule as the storefront catalogue: an inactive,
  // non-active, deleted, or archived variant (or an internal inventory
  // anchor) can never back a savings goal, even when the caller retains its
  // UUID from before it was hidden.
  const variants = (product.variants ?? []).filter(
    isStorefrontProductVariantPublic
  );
  const hasVariants = variants.length > 0;
  const requestedVariantId = variantId?.trim() || null;

  if (hasVariants && !requestedVariantId) {
    return {
      code: 'SAVINGS_DEVICE_VARIANT_REQUIRED',
      error: 'Select the exact device variant to save for',
      ok: false,
      status: 400,
    };
  }

  const variant = requestedVariantId
    ? (variants.find((candidate) => candidate.id === requestedVariantId) ??
      null)
    : null;

  if (requestedVariantId && !variant) {
    return {
      code: 'SAVINGS_DEVICE_VARIANT_NOT_FOUND',
      error: 'Savings device variant is not available',
      ok: false,
      status: 404,
    };
  }

  const cataloguePrice = toPositiveAmount(
    variant?.price_override ?? product.price
  );
  if (cataloguePrice === null) {
    return {
      code: 'SAVINGS_DEVICE_PRICE_INVALID',
      error: 'Savings device price is not available',
      ok: false,
      status: 409,
    };
  }

  if (
    typeof clientTargetAmount === 'number' &&
    Number.isFinite(clientTargetAmount) &&
    clientTargetAmount < cataloguePrice
  ) {
    return {
      code: 'SAVINGS_DEVICE_PRICE_STALE',
      error: 'Savings target is below the current device price',
      ok: false,
      status: 409,
    };
  }

  const targetAmount =
    typeof clientTargetAmount === 'number' &&
    Number.isFinite(clientTargetAmount) &&
    clientTargetAmount >= cataloguePrice
      ? clientTargetAmount
      : cataloguePrice;

  return {
    cataloguePrice,
    ok: true,
    snapshot: buildProductSnapshot({
      product,
      targetAmount,
      variant,
    }),
    targetAmount,
    variant,
    variantId: variant?.id ?? null,
  };
}
