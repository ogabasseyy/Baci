import { isInternalSelectionAxis } from '@/lib/product-internal-selection-axes';
import type { ProductVariant } from '@/types/product';

const COLOR_HEX_MAP: Record<string, string> = {
  black: '#1a1a1a',
  'space black': '#1a1a1a',
  'midnight black': '#0d0d0d',
  white: '#FFFFFF',
  silver: '#C0C0C0',
  gold: '#F5E0C3',
  'rose gold': '#E8B4A0',
  blue: '#3B82F6',
  'sierra blue': '#69ABCE',
  'pacific blue': '#2D5F7C',
  'deep purple': '#6B21A8',
  purple: '#9333EA',
  red: '#EF4444',
  'product red': '#EF4444',
  green: '#22C55E',
  'alpine green': '#505E48',
  yellow: '#FCD34D',
  orange: '#FB923C',
  pink: '#EC4899',
  gray: '#6B7280',
  graphite: '#4A4A4A',
  'natural titanium': '#8A8D8F',
  'blue titanium': '#3F4E57',
  'black titanium': '#3D3D3D',
  'white titanium': '#E8E8E8',
};

interface ColorOption {
  name: string;
  value: string;
  images?: string[];
}

interface StorageOption {
  value: string;
  stock?: number;
}

interface GenericAttributeOption {
  axis: string;
  values: string[];
}

interface VariantOptionsInput {
  attributes?: Record<string, string[]>;
  colors?: (string | { name: string; value: string })[];
  colorImages?: Record<string, string[]>;
  hideConditionAttributes?: boolean;
  storage?: string | string[];
  variants?: ProductVariant[];
}

function getColorHex(colorName: string): string {
  const lower = colorName.toLowerCase();

  if (COLOR_HEX_MAP[lower]) {
    return COLOR_HEX_MAP[lower];
  }

  for (const [key, value] of Object.entries(COLOR_HEX_MAP)) {
    if (lower.includes(key) || key.includes(lower)) {
      return value;
    }
  }

  return '#9CA3AF';
}

function shouldHideGenericAttributeAxis(
  axis: string,
  hideConditionAttributes: boolean
) {
  const normalizedAxis = axis
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  return (
    isInternalSelectionAxis(normalizedAxis) &&
    (hideConditionAttributes || normalizedAxis !== 'condition')
  );
}

function getGenericAttributeAxis(axis: string) {
  const normalizedAxis = axis
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  return normalizedAxis === 'condition' ? 'condition' : axis;
}

/**
 * Selector-facing variant stock, mirroring the PDP purchase check:
 * unlimited tracking stays enabled with no count (there is no finite
 * stock to display), strict tracking compares exact serialized units,
 * and other policies use the raw quantity.
 */
function resolveVariantOptionStock(
  variant: ProductVariant | undefined
): number | undefined {
  if (variant?.effective_policy === 'serialized_then_unlimited')
    return undefined;
  if (
    variant?.effective_policy === 'serialized_strict' &&
    typeof variant.available_units === 'number'
  )
    return variant.available_units;
  return variant?.stock_quantity;
}

export function normalizeVariantOptions({
  attributes,
  colors,
  colorImages,
  hideConditionAttributes = true,
  storage,
  variants,
}: VariantOptionsInput) {
  const hasImageDrivenColors = Boolean(
    colorImages && Object.keys(colorImages).length > 0
  );
  const normalizedColors: ColorOption[] = [];

  if (hasImageDrivenColors) {
    for (const [colorName, images] of Object.entries(colorImages ?? {})) {
      normalizedColors.push({
        name: colorName,
        value: getColorHex(colorName),
        images,
      });
    }
  } else {
    for (const color of colors ?? []) {
      normalizedColors.push(
        typeof color === 'string'
          ? { name: color, value: getColorHex(color) }
          : {
              name: color.name,
              value: color.value || getColorHex(color.name),
            }
      );
    }
  }

  const normalizedStorage: StorageOption[] = [];
  if (storage) {
    const storageArray = Array.isArray(storage) ? storage : [storage];
    const uniqueStorage = Array.from(
      new Set(storageArray.map((value) => value.trim()).filter(Boolean))
    );

    for (const value of uniqueStorage) {
      const variant = variants?.find(
        (candidate) =>
          candidate.attributes?.storage === value ||
          candidate.name?.includes(value)
      );
      normalizedStorage.push({
        value,
        stock: resolveVariantOptionStock(variant),
      });
    }
  }

  const genericAttributes = new Map<string, Set<string>>();
  for (const [axis, values] of Object.entries(attributes ?? {})) {
    if (shouldHideGenericAttributeAxis(axis, hideConditionAttributes)) {
      continue;
    }

    const attributeAxis = getGenericAttributeAxis(axis);
    const axisValues =
      genericAttributes.get(attributeAxis) ?? new Set<string>();
    for (const value of values) {
      const trimmedValue = value.trim();
      if (trimmedValue) {
        axisValues.add(trimmedValue);
      }
    }
    if (axisValues.size > 0) {
      genericAttributes.set(attributeAxis, axisValues);
    }
  }

  for (const variant of variants ?? []) {
    for (const [axis, value] of Object.entries(variant.attributes ?? {})) {
      if (shouldHideGenericAttributeAxis(axis, hideConditionAttributes)) {
        continue;
      }

      const trimmedValue = value.trim();
      if (!trimmedValue) {
        continue;
      }

      const attributeAxis = getGenericAttributeAxis(axis);
      const axisValues =
        genericAttributes.get(attributeAxis) ?? new Set<string>();
      axisValues.add(trimmedValue);
      genericAttributes.set(attributeAxis, axisValues);
    }
  }

  const normalizedGenericAttributes: GenericAttributeOption[] = Array.from(
    genericAttributes.entries()
  ).map(([axis, values]) => ({ axis, values: Array.from(values) }));

  return {
    hasImageDrivenColors,
    normalizedColors,
    normalizedStorage,
    normalizedGenericAttributes,
  };
}
