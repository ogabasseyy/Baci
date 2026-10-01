import {
  canonicalizeCommerceVariantAxis,
  getCommerceVariantAxes,
  normalizeCanonicalProductCondition,
  normalizeCommerceVariantOption,
} from '@baci/shared/lib';
import { isRenderableVariantAxis } from './non-renderable-variant-axes';

interface VariantAttributeDefinition {
  options?: unknown;
  param?: unknown;
}

interface VariantAttributeCarrier {
  attributes?: Record<string, unknown> | null;
  condition?: string | null;
}

export type VariantAttributeSource =
  | Record<string, unknown>
  | VariantAttributeDefinition[]
  | null
  | undefined;

export function canonicalizeVariantAxis(axis: string) {
  return axis
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function pushUniqueOption(
  axisOptions: Record<string, string[]>,
  axis: string,
  value: unknown
) {
  if (typeof value !== 'string') {
    return;
  }

  const trimmedValue = normalizeVariantAxisOption(axis, value);
  if (!trimmedValue) {
    return;
  }

  if (!axisOptions[axis]) {
    axisOptions[axis] = [];
  }

  if (!axisOptions[axis].includes(trimmedValue)) {
    axisOptions[axis].push(trimmedValue);
  }
}

function normalizeVariantAxisOption(axis: string, value: unknown) {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmedValue = value.trim();

  if (axis === 'condition') {
    return normalizeCanonicalProductCondition(trimmedValue);
  }

  return trimmedValue;
}

function normalizeCommerceAxisOption(axis: string, value: unknown) {
  if (axis === 'condition') {
    return typeof value === 'string'
      ? normalizeCanonicalProductCondition(value)
      : '';
  }

  return normalizeCommerceVariantOption(axis, value);
}

export function normalizeVariantAttributes(source: VariantAttributeSource) {
  const axisOptions: Record<string, string[]> = {};
  if (Array.isArray(source)) {
    for (const entry of source) {
      if (
        !entry ||
        typeof entry !== 'object' ||
        typeof entry.param !== 'string'
      ) {
        continue;
      }

      const axis = canonicalizeVariantAxis(entry.param);
      if (!axis) {
        continue;
      }

      const options = Array.isArray(entry.options)
        ? entry.options
        : entry.options === undefined || entry.options === null
          ? []
          : [entry.options];

      for (const option of options) {
        pushUniqueOption(axisOptions, axis, option);
      }
    }

    return axisOptions;
  }
  if (!source || typeof source !== 'object') {
    return axisOptions;
  }

  for (const [rawAxis, options] of Object.entries(source)) {
    const axis = canonicalizeVariantAxis(rawAxis);
    if (!axis) {
      continue;
    }

    const values = Array.isArray(options) ? options : [options];
    for (const value of values) {
      pushUniqueOption(axisOptions, axis, value);
    }
  }

  return axisOptions;
}

export function getVariantAttributeOptions(
  source: VariantAttributeSource,
  axis: string
) {
  const normalizedAxis = canonicalizeVariantAxis(axis);
  return normalizeVariantAttributes(source)[normalizedAxis] || [];
}

function normalizeVariantAttributeRecord(
  attributes: Record<string, unknown> | null | undefined
) {
  const normalized: Record<string, string> = {};

  for (const [rawAxis, value] of Object.entries(attributes ?? {})) {
    const axis = canonicalizeCommerceVariantAxis(rawAxis);
    const normalizedValue = axis
      ? normalizeCommerceAxisOption(axis, value)
      : '';

    if (axis && normalizedValue) {
      normalized[axis] = normalizedValue;
    }
  }

  return normalized;
}

function getVariantAxisValue(
  variant: VariantAttributeCarrier,
  normalizedAttributes: Record<string, string>,
  axis: string
) {
  if (axis === 'condition') {
    return normalizeCanonicalProductCondition(variant.condition);
  }

  return normalizedAttributes[axis];
}

export function mergeVariantAxisOptions(
  variants: VariantAttributeCarrier[] | null | undefined,
  source: VariantAttributeSource,
  fallbackCondition?: string | null
) {
  const normalizedSource = normalizeVariantAttributes(source);
  const liveAxes = (variants ?? []).flatMap((variant) =>
    Object.keys(variant.attributes ?? {})
  );
  const commerceAxes = new Set(getCommerceVariantAxes(source, liveAxes));
  const axisOptions: Record<string, string[]> = {};

  for (const [rawAxis, options] of Object.entries(normalizedSource)) {
    const axis = canonicalizeCommerceVariantAxis(rawAxis);
    if (!(axis && axis !== 'condition' && commerceAxes.has(axis))) {
      continue;
    }

    for (const option of options) {
      pushUniqueOption(
        axisOptions,
        axis,
        normalizeCommerceAxisOption(axis, option)
      );
    }
  }

  for (const variant of variants || []) {
    for (const [rawAxis, value] of Object.entries(variant.attributes || {})) {
      const axis = canonicalizeCommerceVariantAxis(rawAxis);
      if (!(axis && axis !== 'condition' && commerceAxes.has(axis))) {
        continue;
      }

      pushUniqueOption(
        axisOptions,
        axis,
        normalizeCommerceAxisOption(axis, value)
      );
    }

    pushUniqueOption(
      axisOptions,
      'condition',
      variant.condition ?? fallbackCondition
    );
  }

  return axisOptions;
}

export function getAvailableOptionsForAxis(
  axis: string,
  variants: VariantAttributeCarrier[] | null | undefined,
  currentSelections: Record<string, string>
): string[] {
  const normalizedAxis = canonicalizeCommerceVariantAxis(axis);
  if (!normalizedAxis) {
    return [];
  }

  const normalizedSelections = Object.fromEntries(
    Object.entries(currentSelections)
      .flatMap(([key, value]) => {
        const selectionAxis = canonicalizeCommerceVariantAxis(key);
        if (!selectionAxis || selectionAxis === normalizedAxis) {
          return [];
        }

        return [
          [
            selectionAxis,
            normalizeCommerceAxisOption(selectionAxis, value),
          ] as const,
        ];
      })
      .filter(([, value]) => Boolean(value))
  );

  const reachable = new Set<string>();
  for (const variant of variants ?? []) {
    const normalizedAttributes = normalizeVariantAttributeRecord(
      variant.attributes
    );
    const matchesAll = Object.entries(normalizedSelections).every(
      ([selectionAxis, value]) =>
        getVariantAxisValue(variant, normalizedAttributes, selectionAxis) ===
        value
    );
    if (matchesAll) {
      const value = getVariantAxisValue(
        variant,
        normalizedAttributes,
        normalizedAxis
      );
      if (typeof value === 'string' && value.trim()) {
        reachable.add(value.trim());
      }
    }
  }
  return Array.from(reachable);
}

export function getRenderableVariantAxes(
  variants: VariantAttributeCarrier[] | null | undefined,
  source: VariantAttributeSource,
  fallbackCondition?: string | null
) {
  const priorityOrder = [
    'condition',
    'storage',
    'ram',
    'sim_type',
    'connectivity',
    'size',
    'platform',
  ];

  return Object.entries(
    mergeVariantAxisOptions(variants, source, fallbackCondition)
  )
    .filter(([axis, options]) => isRenderableVariantAxis(axis, options.length))
    .sort(([leftAxis], [rightAxis]) => {
      const leftPriority = priorityOrder.indexOf(leftAxis);
      const rightPriority = priorityOrder.indexOf(rightAxis);
      const priorityDifference =
        (leftPriority === -1 ? priorityOrder.length : leftPriority) -
        (rightPriority === -1 ? priorityOrder.length : rightPriority);
      return priorityDifference || leftAxis.localeCompare(rightAxis);
    })
    .map(([axis]) => axis);
}
