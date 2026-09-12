import { getCommerceVariantAxes } from '@baci/shared';
import type { AdminProductVariant } from '@/lib/product-picker-variant-rows';
import {
  formatAttributeLabel,
  getOrderedGroupKeys,
  getVariantAttributeEntries,
  getVariantAttributeMap,
} from '@/lib/product-variant-attributes';

export interface VariantOptionValue {
  available: boolean;
  label: string;
  selected: boolean;
  value: string;
}

export interface VariantOptionGroup {
  key: string;
  label: string;
  values: VariantOptionValue[];
}

export type VariantOptionSelection = Record<string, string>;

export interface VariantOptionGroupConfig {
  declaration?: unknown;
}

const CAPACITY_OPTION_AXIS_KEYS = new Set([
  'capacity',
  'memory',
  'ram',
  'rom',
  'storage',
]);

const CAPACITY_UNIT_FACTORS_IN_GB: Record<string, number> = {
  gb: 1,
  kb: 1 / (1024 * 1024),
  mb: 1 / 1024,
  tb: 1024,
};

function shouldSortByCapacity(key: string): boolean {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[._\s-]+/)
    .some((segment) => CAPACITY_OPTION_AXIS_KEYS.has(segment));
}

function parseCapacityValue(value: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([kmgt]b)\b/i.exec(value);
  if (!match) {
    return null;
  }

  const amount = Number.parseFloat(match[1] ?? '');
  const unitFactor = CAPACITY_UNIT_FACTORS_IN_GB[match[2]?.toLowerCase() ?? ''];
  if (!Number.isFinite(amount) || unitFactor === undefined) {
    return null;
  }

  return amount * unitFactor;
}

function compareCapacityValues(left: string, right: string): number {
  const leftCapacity = parseCapacityValue(left);
  const rightCapacity = parseCapacityValue(right);

  if (leftCapacity !== null && rightCapacity !== null) {
    return leftCapacity === rightCapacity
      ? left.localeCompare(right, undefined, {
          numeric: true,
          sensitivity: 'base',
        })
      : leftCapacity - rightCapacity;
  }

  if (leftCapacity !== null) {
    return -1;
  }

  if (rightCapacity !== null) {
    return 1;
  }

  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function getSortedOptionValues(key: string, values: string[]): string[] {
  if (!shouldSortByCapacity(key)) {
    return values;
  }

  return [...values].sort(compareCapacityValues);
}

function variantMatchesSelection(
  variant: AdminProductVariant,
  selection: VariantOptionSelection,
  exceptKey?: string,
  knownKeys?: ReadonlySet<string>
): boolean {
  const attributeMap = getVariantAttributeMap(variant);
  return Object.entries(selection).every(([key, value]) => {
    if (key === exceptKey || !value) {
      return true;
    }

    if (!(key in attributeMap)) {
      return !knownKeys?.has(key);
    }

    return attributeMap[key] === value;
  });
}

export function buildVariantOptionGroups(
  variants: AdminProductVariant[],
  selection: VariantOptionSelection,
  config: VariantOptionGroupConfig = {}
): VariantOptionGroup[] {
  const labelsByKey = new Map<string, string>();
  const valuesByKey = new Map<string, string[]>();

  for (const variant of variants) {
    // Use the coalesced map so aliased keys (gpu/graphics) contribute one value.
    const attributeMap = getVariantAttributeMap(variant);
    for (const [key, value] of Object.entries(attributeMap)) {
      labelsByKey.set(key, formatAttributeLabel(key));
      const values = valuesByKey.get(key) ?? [];
      if (!values.includes(value)) {
        values.push(value);
      }
      valuesByKey.set(key, values);
    }
  }

  const commerceAxes = getCommerceVariantAxes(config.declaration, [
    ...valuesByKey.keys(),
  ]);
  if (valuesByKey.has('condition') && !commerceAxes.includes('condition')) {
    commerceAxes.unshift('condition');
  }
  const knownKeys = new Set(commerceAxes);

  return getOrderedGroupKeys(commerceAxes).flatMap((key) => {
    const values = getSortedOptionValues(key, valuesByKey.get(key) ?? []);
    if (values.length <= 1) {
      return [];
    }

    return [
      {
        key,
        label: labelsByKey.get(key) ?? formatAttributeLabel(key),
        values: values.map((value) => ({
          available: variants.some((variant) => {
            const attributeMap = getVariantAttributeMap(variant);
            return (
              attributeMap[key] === value &&
              variantMatchesSelection(variant, selection, key, knownKeys)
            );
          }),
          label: value,
          selected: selection[key] === value,
          value,
        })),
      },
    ];
  });
}

export function completeSingleValueSelection(
  variants: AdminProductVariant[],
  selection: VariantOptionSelection,
  config: VariantOptionGroupConfig = {},
  initialGroups = buildVariantOptionGroups(variants, selection, config)
): VariantOptionSelection {
  let nextSelection = selection;
  const maxPasses = Math.max(1, initialGroups.length);

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const groups =
      pass === 0
        ? initialGroups
        : buildVariantOptionGroups(variants, nextSelection, config);
    let changed = false;

    for (const group of groups) {
      if (nextSelection[group.key]?.trim()) {
        continue;
      }

      const availableValues = group.values.filter((value) => value.available);
      if (availableValues.length !== 1) {
        continue;
      }

      if (nextSelection === selection) {
        nextSelection = { ...selection };
      }
      nextSelection[group.key] = availableValues[0]?.value ?? '';
      changed = true;
    }

    if (!changed) {
      return nextSelection;
    }
  }

  return nextSelection;
}

export function resolveSelectedVariant(
  variants: AdminProductVariant[],
  selection: VariantOptionSelection,
  config: VariantOptionGroupConfig = {}
): AdminProductVariant | null {
  const knownKeys = new Set(
    getCommerceVariantAxes(
      config.declaration,
      variants.flatMap((variant) =>
        getVariantAttributeEntries(variant).map((entry) => entry.key)
      )
    )
  );
  if (variants.some((variant) => getVariantAttributeMap(variant).condition)) {
    knownKeys.add('condition');
  }
  const matches = variants.filter((variant) =>
    variantMatchesSelection(variant, selection, undefined, knownKeys)
  );

  return matches.length === 1 ? matches[0] : null;
}

export function selectVariantOption(
  variants: AdminProductVariant[],
  selection: VariantOptionSelection,
  key: string,
  value: string,
  config: VariantOptionGroupConfig = {}
): VariantOptionSelection {
  const nextSelection = {
    ...selection,
    [key]: selection[key] === value ? '' : value,
  };

  if (!nextSelection[key]) {
    return nextSelection;
  }

  const groupsForNewSelection = buildVariantOptionGroups(
    variants,
    { [key]: nextSelection[key] },
    config
  );

  return Object.fromEntries(
    Object.entries(nextSelection).filter(([candidateKey, selectedValue]) => {
      if (!selectedValue || candidateKey === key) {
        return Boolean(selectedValue);
      }

      const candidateGroup = groupsForNewSelection.find(
        (group) => group.key === candidateKey
      );

      return Boolean(
        candidateGroup?.values.some(
          (option) => option.value === selectedValue && option.available
        )
      );
    })
  );
}
