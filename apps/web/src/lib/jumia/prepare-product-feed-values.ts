import type { JumiaAttributeSetResponse } from '@/schemas/jumia/catalog';
import type { JumiaDraftValue } from './attribute-values';
import {
  type JumiaDraftAttribute,
  validateAttributeValue,
} from './attribute-values';

export type VariationValue = {
  draftValue: JumiaDraftValue;
  wireValue: string;
};

export function isHttpImageUrl(value: string | null): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

export function stableSourceValue(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(stableSourceValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(
        ([key, entry]) => `${JSON.stringify(key)}:${stableSourceValue(entry)}`
      )
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

export function serializeVariationValue(
  attribute: JumiaAttributeSetResponse['attributes'][number],
  raw: unknown
): VariationValue | null {
  if (attribute.type === 0 || attribute.type === 1) {
    return typeof raw === 'string' &&
      validateAttributeValue(attribute as JumiaDraftAttribute, raw) === null
      ? { draftValue: raw, wireValue: raw }
      : null;
  }
  if (attribute.type === 2 || attribute.type === 8) {
    const value =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && raw.trim()
          ? Number(raw)
          : Number.NaN;
    return Number.isFinite(value) &&
      validateAttributeValue(attribute as JumiaDraftAttribute, value) === null
      ? { draftValue: value, wireValue: String(value) }
      : null;
  }
  if (attribute.type === 4 && typeof raw === 'string') {
    const options =
      attribute.options?.filter(
        (option) => option.status === 'ACTIVE' && option.name === raw
      ) ?? [];
    return options.length === 1
      ? { draftValue: options[0].id, wireValue: options[0].name }
      : null;
  }
  if (attribute.type === 6) {
    const value =
      typeof raw === 'boolean'
        ? raw
        : raw === 'true'
          ? true
          : raw === 'false'
            ? false
            : undefined;
    return value !== undefined
      ? { draftValue: value, wireValue: String(value) }
      : null;
  }
  if (
    (attribute.type === 5 || attribute.type === 7) &&
    typeof raw === 'string'
  ) {
    return validateAttributeValue(attribute as JumiaDraftAttribute, raw) ===
      null
      ? { draftValue: raw, wireValue: raw }
      : null;
  }
  return null;
}

export function serializeAttributeValue(
  definition: JumiaAttributeSetResponse['attributes'][number],
  value: JumiaDraftValue
): string | null {
  if (
    (definition.type === 0 ||
      definition.type === 1 ||
      definition.type === 5 ||
      definition.type === 7) &&
    typeof value === 'string'
  )
    return value;
  if (
    (definition.type === 2 || definition.type === 8) &&
    typeof value === 'number'
  )
    return String(value);
  if (definition.type === 6 && typeof value === 'boolean') return String(value);
  if (definition.type === 4 && typeof value === 'number') {
    const options =
      definition.options?.filter(
        (option) => option.id === value && option.status === 'ACTIVE'
      ) ?? [];
    return options.length === 1 ? options[0].name : null;
  }
  return null;
}
