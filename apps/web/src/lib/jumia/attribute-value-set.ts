import { JumiaAttributeSetResponseSchema } from '@/schemas/jumia/catalog';
import {
  attributeUnavailableReason,
  type JumiaDraftAttribute,
  type JumiaDraftValue,
  validateAttributeValue,
} from './attribute-values';

export type JumiaAttributeValueSetResult =
  | { success: false; errors: { field: string; message: string }[] }
  | { success: true; values: Record<string, JumiaDraftValue> };

function plainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
    Reflect.ownKeys(value).every(
      (key) =>
        typeof key === 'string' &&
        Object.getOwnPropertyDescriptor(value, key)?.enumerable &&
        'value' in (Object.getOwnPropertyDescriptor(value, key) ?? {})
    )
  );
}

function explicitArray(value: unknown): value is unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    return false;
  // Dense index data plus length are the only allowed own properties. Reject
  // methods, accessors and iterators before any consumer invokes array behavior.
  for (let index = 0; index < value.length; index++) {
    if (!('value' in (Object.getOwnPropertyDescriptor(value, index) ?? {})))
      return false;
  }
  return true;
}

function explicitMetadata(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value !== 'object') return true;
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? explicitArray(value) &&
      value.every((item) => explicitMetadata(item, seen))
    : plainRecord(value) &&
      Object.values(value).every((item) => explicitMetadata(item, seen));
  seen.delete(value);
  return valid;
}

function definition(value: unknown): value is JumiaDraftAttribute {
  if (
    !plainRecord(value) ||
    !explicitMetadata(value) ||
    typeof value.type !== 'number' ||
    !Number.isInteger(value.type)
  )
    return false;
  if (
    ![
      'code',
      'name',
      'description',
      'type',
      'mandatory',
      'variation',
      'translatable',
    ].every((key) => Object.hasOwn(value, key))
  )
    return false;
  if (value.validations !== undefined && !plainRecord(value.validations))
    return false;
  if (
    value.options !== undefined &&
    (!explicitArray(value.options) || !value.options.every(plainRecord))
  )
    return false;
  // Reuse the wire contract without changing it or stripping accepted facts.
  // Substituting the type ONLY for structural validation permits omission of
  // unsupported optional controls; the original kind still governs values.
  if (
    !JumiaAttributeSetResponseSchema.safeParse({
      attributes: [{ ...value, type: 0 }],
    }).success
  )
    return false;
  const attribute = value as JumiaDraftAttribute;
  if (!attribute.name.trim()) return false;
  const rules = attribute.validations;
  for (const bound of [rules?.minLength, rules?.maxLength])
    if (bound != null && (!Number.isSafeInteger(bound) || bound < 0))
      return false;
  if (
    rules?.minLength != null &&
    rules.maxLength != null &&
    rules.minLength > rules.maxLength
  )
    return false;
  if (
    rules?.decimalPlaces != null &&
    (!Number.isInteger(rules.decimalPlaces) ||
      rules.decimalPlaces < 0 ||
      rules.decimalPlaces > 100)
  )
    return false;
  const ids = attribute.options?.map((option) => option.id) ?? [];
  return new Set(ids).size === ids.length;
}

/**
 * Validate explicit typed values by String(code), not provider wire strings.
 * No defaults, content projection, special-field precedence, coercion or I/O.
 * Canonical serialization must inject authoritative special product fields and
 * rerun this validator; content preparation alone cannot satisfy requiredness.
 * Percentage metadata is preserved, not treated as an undocumented 0–100 rule.
 */
export function validateJumiaAttributeValueSet(
  definitions: unknown,
  supplied: unknown
): JumiaAttributeValueSetResult {
  const errors: { field: string; message: string }[] = [];
  if (!explicitArray(definitions))
    return {
      success: false,
      errors: [
        {
          field: 'definitions',
          message: 'Supply an explicit attribute definition list.',
        },
      ],
    };
  const attributes: JumiaDraftAttribute[] = [];
  const codes = new Set<string>();
  const names = new Set<string>();
  for (let index = 0; index < definitions.length; index++) {
    const candidate = definitions[index];
    if (!definition(candidate)) {
      errors.push({
        field: `definitions.${index}`,
        message:
          'Attribute metadata is malformed or ambiguous. Refresh metadata.',
      });
      continue;
    }
    const code = String(candidate.code);
    const name = candidate.name.trim().toLowerCase();
    if (codes.has(code) || names.has(name))
      errors.push({
        field: `definitions.${index}`,
        message:
          'Attribute codes and names must be unambiguous. Refresh metadata.',
      });
    codes.add(code);
    names.add(name);
    attributes.push(candidate);
  }
  if (!plainRecord(supplied)) {
    errors.push({
      field: 'values',
      message: 'Supply an explicit attribute-value dictionary.',
    });
    return { success: false, errors };
  }
  for (const key of Object.keys(supplied).sort()) {
    if (!codes.has(key))
      errors.push({
        field: `values.${key}`,
        message: 'No attribute definition exists for this key.',
      });
  }
  const values: Record<string, JumiaDraftValue> = {};
  for (const attribute of attributes) {
    const code = String(attribute.code);
    const value = Object.hasOwn(supplied, code) ? supplied[code] : undefined;
    const wrongEmptyType =
      (value === '' && ![0, 1].includes(attribute.type)) ||
      (Array.isArray(value) && value.length === 0 && attribute.type !== 3);
    const message =
      (value !== undefined ? attributeUnavailableReason(attribute) : null) ??
      (wrongEmptyType
        ? 'Supply a value of the declared attribute type.'
        : Array.isArray(value) && !explicitArray(value)
          ? 'Supply only explicit selection IDs.'
          : validateAttributeValue(attribute, value));
    if (message) errors.push({ field: `values.${code}`, message });
    else if (value !== undefined) values[code] = value as JumiaDraftValue;
  }
  return errors.length ? { success: false, errors } : { success: true, values };
}
