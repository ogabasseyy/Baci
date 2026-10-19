import { canonicalizeCommerceVariantAxis } from '@baci/shared';
import {
  formatProductConditionDisplay,
  formatVariantAxisLabel,
  type ProductVariant,
} from '@/types/product';

export type SavingsVariantSelection = Record<string, string>;

export type SavingsVariantOptionValue = {
  available: boolean;
  label: string;
  selected: boolean;
  value: string;
};

export type SavingsVariantOptionGroup = {
  key: string;
  label: string;
  values: SavingsVariantOptionValue[];
};

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

function shouldSortByCapacity(key: string) {
  return CAPACITY_OPTION_AXIS_KEYS.has(key);
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

function compareCapacityValues(left: string, right: string) {
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

function getSortedOptionValues(key: string, values: string[]) {
  if (!shouldSortByCapacity(key)) {
    return values;
  }

  return [...values].sort(compareCapacityValues);
}

function normalizeOptionValue(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

export function getSavingsVariantAttributeMap(
  variant: Pick<ProductVariant, 'attributes' | 'condition'>
) {
  const attributeMap: Record<string, string> = {};

  for (const [axis, value] of Object.entries(variant.attributes ?? {})) {
    const key = canonicalizeCommerceVariantAxis(axis);
    const normalizedValue = normalizeOptionValue(value);
    if (key && key !== 'hex' && normalizedValue && !(key in attributeMap)) {
      attributeMap[key] = normalizedValue;
    }
  }

  const condition = normalizeOptionValue(variant.condition);
  if (condition && !('condition' in attributeMap)) {
    attributeMap.condition = condition;
  }

  return attributeMap;
}

function variantMatchesSelection(
  variant: Pick<ProductVariant, 'attributes' | 'condition'>,
  selection: SavingsVariantSelection,
  exceptKey?: string
) {
  const attributeMap = getSavingsVariantAttributeMap(variant);
  return Object.entries(selection).every(([key, value]) => {
    if (key === exceptKey || !value) {
      return true;
    }
    return attributeMap[key] === value;
  });
}

function formatOptionLabel(key: string, value: string) {
  if (key === 'condition') {
    return formatProductConditionDisplay(value) ?? value;
  }
  return value;
}

export function buildSavingsVariantOptionGroups(
  variants: Pick<ProductVariant, 'attributes' | 'condition'>[],
  selection: SavingsVariantSelection
): SavingsVariantOptionGroup[] {
  const valuesByKey = new Map<string, string[]>();

  for (const variant of variants) {
    for (const [key, value] of Object.entries(
      getSavingsVariantAttributeMap(variant)
    )) {
      const values = valuesByKey.get(key) ?? [];
      if (!values.includes(value)) {
        values.push(value);
      }
      valuesByKey.set(key, values);
    }
  }

  const groups: SavingsVariantOptionGroup[] = [];
  for (const [key, values] of valuesByKey) {
    if (values.length <= 1) {
      continue;
    }
    groups.push({
      key,
      label: formatVariantAxisLabel(key) ?? key,
      values: getSortedOptionValues(key, values).map((value) => ({
        available: variants.some(
          (variant) =>
            getSavingsVariantAttributeMap(variant)[key] === value &&
            variantMatchesSelection(variant, selection, key)
        ),
        label: formatOptionLabel(key, value),
        selected: selection[key] === value,
        value,
      })),
    });
  }

  return groups;
}

export function resolveSavingsVariant<
  T extends Pick<ProductVariant, 'attributes' | 'condition'>,
>(variants: T[], selection: SavingsVariantSelection): T | null {
  const matches = variants.filter((variant) =>
    variantMatchesSelection(variant, selection)
  );

  return matches.length === 1 ? (matches[0] ?? null) : null;
}

export function selectSavingsVariantOption(
  variants: Pick<ProductVariant, 'attributes' | 'condition'>[],
  selection: SavingsVariantSelection,
  key: string,
  value: string
): SavingsVariantSelection {
  const nextSelection = {
    ...selection,
    [key]: selection[key] === value ? '' : value,
  };

  if (!nextSelection[key]) {
    return nextSelection;
  }

  return Object.fromEntries(
    Object.entries(nextSelection).filter(([candidateKey, selectedValue]) => {
      if (!selectedValue || candidateKey === key) {
        return Boolean(selectedValue);
      }

      const candidateGroup = buildSavingsVariantOptionGroups(variants, {
        [key]: nextSelection[key] ?? '',
      }).find((group) => group.key === candidateKey);

      return Boolean(
        candidateGroup?.values.some(
          (option) => option.value === selectedValue && option.available
        )
      );
    })
  );
}

export function completeSavingsSingleValueSelection(
  variants: Pick<ProductVariant, 'attributes' | 'condition'>[],
  selection: SavingsVariantSelection
): SavingsVariantSelection {
  let nextSelection = selection;
  const maxPasses = Math.max(
    1,
    buildSavingsVariantOptionGroups(variants, selection).length
  );

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const groups = buildSavingsVariantOptionGroups(variants, nextSelection);
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

export function seedSavingsVariantSelection(
  variants: Pick<ProductVariant, 'attributes' | 'condition' | 'id'>[],
  variantId?: string | null
): SavingsVariantSelection {
  if (!variantId) {
    return {};
  }
  const variant = variants.find((candidate) => candidate.id === variantId);
  return variant ? getSavingsVariantAttributeMap(variant) : {};
}
