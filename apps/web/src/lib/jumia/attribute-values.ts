import type { JumiaAttributeSetResponse } from '@/schemas/jumia/catalog';

export type JumiaDraftAttribute = Omit<
  JumiaAttributeSetResponse['attributes'][number],
  'type'
> & { type: number };
export type JumiaDraftValue = string | number | boolean | number[];
export type JumiaDraftValues = Record<string, JumiaDraftValue | undefined>;

export function attributeUnavailableReason(
  attribute: JumiaDraftAttribute
): string | null {
  if (![0, 1, 2, 3, 4, 5, 6, 7, 8].includes(attribute.type))
    return 'Unsupported attribute type. Refresh metadata or contact support.';
  if (
    [3, 4].includes(attribute.type) &&
    !attribute.options?.some((option) => option.status === 'ACTIVE')
  )
    return 'No active options available. Refresh metadata or contact Jumia.';
  const format = attribute.validations?.dateFormat;
  if (attribute.type === 5 && format !== 'YYYY-MM-DD')
    return 'Date format unavailable or unsupported. Refresh metadata or contact Jumia.';
  if (
    attribute.type === 7 &&
    !['YYYY-MM-DDTHH:mm', 'YYYY-MM-DDTHH:mm:ss'].includes(format ?? '')
  )
    return 'Date/time format unavailable or unsupported. Refresh metadata or contact Jumia.';
  return null;
}

export function validateAttributeValue(
  attribute: JumiaDraftAttribute,
  value: unknown
): string | null {
  const missing =
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0);
  if (missing && !attribute.mandatory) return null;
  const unavailable = attributeUnavailableReason(attribute);
  if (unavailable) return unavailable;
  if (missing) return 'A value is required.';
  const rules = attribute.validations;
  switch (attribute.type) {
    case 0:
    case 1:
      if (typeof value !== 'string' || !value.trim()) return 'Enter text.';
      if (rules?.minLength != null && value.length < rules.minLength)
        return `Enter at least ${rules.minLength} characters.`;
      if (rules?.maxLength != null && value.length > rules.maxLength)
        return `Enter no more than ${rules.maxLength} characters.`;
      return null;
    case 2:
    case 8: {
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (attribute.type === 2 && !Number.isInteger(value))
      )
        return attribute.type === 2
          ? 'Enter a whole number.'
          : 'Enter a finite number.';
      if (rules?.notZeroOrNegative && value <= 0)
        return 'Enter a number greater than zero.';
      if (rules?.decimalPlaces != null) {
        const places = rules.decimalPlaces;
        if (!Number.isInteger(places) || places < 0 || places > 100)
          return 'Numeric precision metadata is unsupported.';
        if (Number(value.toFixed(places)) !== value)
          return `Use at most ${places} decimal places.`;
      }
      return null;
    }
    case 3:
    case 4: {
      const activeIds = new Set(
        attribute.options
          ?.filter((option) => option.status === 'ACTIVE')
          .map((option) => option.id)
      );
      const values = attribute.type === 3 ? value : [value];
      if (
        !Array.isArray(values) ||
        !values.length ||
        values.some(
          (item) => typeof item !== 'number' || !activeIds.has(item)
        ) ||
        new Set(values).size !== values.length
      )
        return 'Choose only active listed options.';
      return null;
    }
    case 5:
    case 7: {
      if (typeof value !== 'string')
        return 'Enter the exact required date format.';
      const format = rules?.dateFormat;
      const pattern =
        attribute.type === 5
          ? /^\d{4}-\d{2}-\d{2}$/
          : format === 'YYYY-MM-DDTHH:mm'
            ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
            : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
      if (!pattern.test(value)) return `Use ${format} exactly.`;
      const canonical =
        attribute.type === 5
          ? `${value}T00:00:00`
          : value.length === 16
            ? `${value}:00`
            : value;
      const date = new Date(`${canonical}Z`);
      if (
        !Number.isFinite(date.getTime()) ||
        date.toISOString().slice(0, 19) !== canonical
      )
        return 'Enter a valid calendar date and time.';
      return null;
    }
    case 6:
      return typeof value === 'boolean' ? null : 'Choose Yes or No explicitly.';
    default:
      return 'Unsupported attribute type.';
  }
}
