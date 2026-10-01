import {
  canonicalizeCommerceVariantAxis,
  normalizeCommerceVariantOption,
} from '@baci/shared';
import type { AdminProductVariant } from '@/lib/product-picker-variant-rows';

export interface VariantAttributeEntry {
  key: string;
  label: string;
  value: string;
}

const PREFERRED_ATTRIBUTE_ORDER = [
  'condition',
  'ram',
  'memory',
  'color',
  'storage',
  'capacity',
];

const ATTRIBUTE_VALUE_KEYS = ['value', 'label', 'name', 'options'] as const;

function normalizeAttributeKey(key: string): string | null {
  return canonicalizeCommerceVariantAxis(key);
}

export function formatAttributeLabel(key: string): string {
  return key
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatConditionLabel(value: string): string {
  return value.trim().replace(/_/g, ' ');
}

function normalizeAttributeValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (Array.isArray(value)) {
    const values = value
      .map((item) => normalizeAttributeValue(item))
      .filter((item): item is string => Boolean(item));
    return values.length > 0 ? values.join(' / ') : null;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of ATTRIBUTE_VALUE_KEYS) {
    const normalized = normalizeAttributeValue(record[key]);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function isRecordAttribute(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function getObjectDisplayValue(record: Record<string, unknown>): string | null {
  for (const key of ATTRIBUTE_VALUE_KEYS) {
    const normalized = normalizeAttributeValue(record[key]);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function extractArrayAttributeEntries(
  value: unknown[]
): VariantAttributeEntry[] {
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }

    const record = item as Record<string, unknown>;
    const rawKey =
      typeof record.key === 'string'
        ? record.key
        : typeof record.param === 'string'
          ? record.param
          : typeof record.name === 'string'
            ? record.name
            : null;

    if (!rawKey) {
      return [];
    }

    const rawNormalizedValue =
      normalizeAttributeValue(record.value) ??
      normalizeAttributeValue(record.label) ??
      normalizeAttributeValue(record.options);

    const key = normalizeAttributeKey(rawKey);
    const normalizedValue = key
      ? normalizeCommerceVariantOption(key, rawNormalizedValue)
      : '';
    if (!(key && normalizedValue)) {
      return [];
    }

    return [
      {
        key,
        label: formatAttributeLabel(key),
        value: normalizedValue,
      },
    ];
  });
}

function extractRecordAttributeEntries(
  record: Record<string, unknown>,
  parentKey = ''
): VariantAttributeEntry[] {
  return Object.entries(record).flatMap(([rawKey, rawValue]) => {
    const keyPath = parentKey ? `${parentKey}.${rawKey}` : rawKey;

    if (isRecordAttribute(rawValue)) {
      const displayValue = getObjectDisplayValue(rawValue);
      if (!displayValue) {
        return extractRecordAttributeEntries(rawValue, keyPath);
      }

      const key = normalizeAttributeKey(keyPath);
      const normalizedValue = key
        ? normalizeCommerceVariantOption(key, displayValue)
        : '';
      if (!(key && normalizedValue)) {
        return [];
      }

      return [
        {
          key,
          label: formatAttributeLabel(key),
          value: normalizedValue,
        },
      ];
    }

    const key = normalizeAttributeKey(keyPath);
    const normalizedValue = key
      ? normalizeCommerceVariantOption(key, normalizeAttributeValue(rawValue))
      : '';
    if (!(key && normalizedValue)) {
      return [];
    }

    return [
      {
        key,
        label: formatAttributeLabel(key),
        value: normalizedValue,
      },
    ];
  });
}

export function getVariantAttributeEntries(
  variant: AdminProductVariant
): VariantAttributeEntry[] {
  const attributeValue = variant.variant_attributes;
  const entries = Array.isArray(attributeValue)
    ? extractArrayAttributeEntries(attributeValue)
    : attributeValue && typeof attributeValue === 'object'
      ? extractRecordAttributeEntries(attributeValue as Record<string, unknown>)
      : [];

  const hasCondition = entries.some((entry) => entry.key === 'condition');
  const conditionValue = variant.condition?.trim();
  if (!hasCondition && conditionValue) {
    return [
      {
        key: 'condition',
        label: 'Condition',
        value: formatConditionLabel(conditionValue),
      },
      ...entries,
    ];
  }

  return entries;
}

export function getVariantAttributeMap(
  variant: AdminProductVariant
): Record<string, string> {
  return Object.fromEntries(
    getVariantAttributeEntries(variant).map((entry) => [entry.key, entry.value])
  );
}

export function getOrderedGroupKeys(keys: string[]): string[] {
  return [...keys].sort((left, right) => {
    const leftIndex = PREFERRED_ATTRIBUTE_ORDER.indexOf(left);
    const rightIndex = PREFERRED_ATTRIBUTE_ORDER.indexOf(right);

    if (leftIndex !== -1 || rightIndex !== -1) {
      return (
        (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) -
        (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex)
      );
    }

    return left.localeCompare(right);
  });
}
