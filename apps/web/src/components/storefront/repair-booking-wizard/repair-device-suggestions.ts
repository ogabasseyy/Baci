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
  category_names?: string[];
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
    pattern: /\b((game|gaming)\s+)?consoles?\b/i,
    deviceType: 'Console',
  },
  {
    pattern: /\b(smart\s?watches?|wearables?)\b/i,
    deviceType: 'Smartwatch',
  },
];

export function toStoreProductSuggestion(
  product: StorefrontProductDeviceCandidate
): StoreProductDeviceSuggestion | null {
  const categories = [
    product.category,
    ...(product.category_names ?? []),
  ].filter((category): category is string => Boolean(category?.trim()));
  if (
    categories.some((category) =>
      /\b(accessor(?:y|ies)|cases?|chargers?|covers?|cables?|screen protectors?|tempered glass)\b/i.test(
        category
      )
    )
  ) {
    return null;
  }
  const categoryDeviceTypes = new Set(
    categories.flatMap((category) =>
      DEVICE_CATEGORY_TYPES.filter(({ pattern }) => pattern.test(category)).map(
        ({ deviceType }) => deviceType
      )
    )
  );
  let deviceType =
    categoryDeviceTypes.size === 1
      ? Array.from(categoryDeviceTypes)[0]
      : undefined;
  if (
    !deviceType &&
    categories.some((category) => /^gaming$/i.test(category.trim())) &&
    !/\b(controllers?|headsets?|games?|game cards?|charging docks?|stands?|cases?|cables?|chargers?)\b/i.test(
      product.name
    ) &&
    /\b(playstation|ps\s?\d|xbox|nintendo\s+switch|gaming\s+console)\b/i.test(
      product.name
    )
  ) {
    deviceType = 'Console';
  }
  if (
    categoryDeviceTypes.size === 2 &&
    categoryDeviceTypes.has('Smartphone') &&
    categoryDeviceTypes.has('Tablet')
  ) {
    const name = product.name;
    const hasTabletCue =
      /\b(ipad|tablets?|galaxy tab|redmi pad|xiaomi pad|lenovo tab)\b/i.test(
        name
      );
    const hasPhoneCue =
      /\b(iphones?|smartphones?|mobile phones?|cell phones?|galaxy [a-z]?\d{1,2}|pixel \d+)\b/i.test(
        name
      );
    if (hasTabletCue !== hasPhoneCue) {
      deviceType = hasTabletCue ? 'Tablet' : 'Smartphone';
    }
  }
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
