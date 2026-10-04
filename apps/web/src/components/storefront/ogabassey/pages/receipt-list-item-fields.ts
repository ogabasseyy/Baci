import { formatCanonicalProductConditionLabel } from '@baci/shared/lib';

// Per-item field projection for the receipts list mapper, split out so the
// mapper stays under the 300-line gate. Pure helpers over the API row
// shape; invalid optionals stay absent, never coerced.

export function getReceiptListItemStringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function getReceiptItemImage(item: Record<string, unknown> | undefined) {
  if (!item) {
    return null;
  }

  return (
    getReceiptListItemStringValue(item.product_image) ||
    getReceiptListItemStringValue(item.image) ||
    getReceiptListItemStringValue(item.image_url) ||
    (Array.isArray(item.product_images)
      ? getReceiptListItemStringValue(item.product_images[0])
      : null)
  );
}

export function getReceiptItemName(item: Record<string, unknown> | undefined) {
  if (!item) {
    return 'Unknown item';
  }

  return (
    getReceiptListItemStringValue(item.product_name) ||
    getReceiptListItemStringValue(item.name) ||
    'Unknown item'
  );
}

export function getReceiptItemVariantName(item: Record<string, unknown> | undefined) {
  return (
    getReceiptListItemStringValue(item?.variant_name) ||
    formatCanonicalProductConditionLabel(getReceiptListItemStringValue(item?.condition))
  );
}

export function getReceiptItemDisplayName(item: Record<string, unknown> | undefined) {
  const baseName = getReceiptItemName(item);
  const variantName = getReceiptItemVariantName(item);
  return variantName && !baseName.includes(`(${variantName})`)
    ? `${baseName} (${variantName})`
    : baseName;
}

export function getReceiptItemQuantity(item: Record<string, unknown>) {
  const quantity = Number(item.quantity);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

export function getOptionalReceiptItemNumber(
  item: Record<string, unknown>,
  key: string
): number | undefined {
  const value = item[key];
  if (value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function getAdditionalDeviceCount(items: Array<Record<string, unknown>>) {
  const totalDeviceCount = items.reduce(
    (count, item) => count + getReceiptItemQuantity(item),
    0
  );

  return Math.max(0, totalDeviceCount - 1);
}

