import type {
  RepairDeviceSummary,
  RepairDeviceType,
} from '@baci/shared/repairs';

export interface StoreProductDeviceSuggestion {
  kind: 'store-product';
  productId: string;
  displayName: string;
  deviceType: RepairDeviceType;
  imageUrl: string | null;
}

export type RepairDeviceSelection =
  | RepairDeviceSummary
  | StoreProductDeviceSuggestion;

export interface RepairDevicesResponse {
  groups: Array<{ brand: string; devices: RepairDeviceSummary[] }>;
}

export interface StorefrontProductDeviceCandidate {
  brand?: string | null;
  category?: string | null;
  id: string;
  image?: string | null;
  name: string;
}

const DEVICE_CATEGORY_TYPES: ReadonlyArray<{
  pattern: RegExp;
  deviceType: RepairDeviceType;
}> = [
  {
    pattern: /\b(smartphones?|mobile phones?|cell phones?|iphones?|phones?)\b/i,
    deviceType: 'Smartphone',
  },
  { pattern: /\b(laptops?|notebooks?)\b/i, deviceType: 'Laptop' },
  { pattern: /\b(tablets?|ipads?)\b/i, deviceType: 'Tablet' },
  {
    pattern: /\b(game consoles?|gaming consoles?)\b/i,
    deviceType: 'Console',
  },
  { pattern: /\bsmart\s?watches?\b/i, deviceType: 'Smartwatch' },
];

export function toStoreProductSuggestion(
  product: StorefrontProductDeviceCandidate
): StoreProductDeviceSuggestion | null {
  const category = product.category ?? '';
  if (
    /\b(accessor(?:y|ies)|cases?|chargers?|covers?|cables?|screen protectors?|tempered glass)\b/i.test(
      category
    )
  ) {
    return null;
  }
  const deviceType = DEVICE_CATEGORY_TYPES.find(({ pattern }) =>
    pattern.test(category)
  )?.deviceType;
  if (!deviceType) {
    return null;
  }

  const brand = product.brand?.trim();
  const name = product.name.trim();
  const displayName =
    brand && !name.toLowerCase().startsWith(brand.toLowerCase())
      ? `${brand} ${name}`
      : name;

  return {
    kind: 'store-product',
    productId: product.id,
    displayName,
    deviceType,
    imageUrl: product.image || null,
  };
}
