import { describe, expect, it } from 'vitest';
import {
  attributeUnavailableReason,
  type JumiaDraftAttribute,
  validateAttributeValue,
} from './attribute-values';

const attribute = (
  type: number,
  extra: Partial<JumiaDraftAttribute> = {}
): JumiaDraftAttribute => ({
  code: 1,
  name: 'Value',
  description: '',
  type,
  mandatory: true,
  variation: false,
  translatable: false,
  ...extra,
});
const option = {
  id: 10,
  sid: '11111111-1111-4111-8111-111111111111',
  name: 'Red',
  position: 0,
  isDefault: true,
  status: 'ACTIVE' as const,
};
describe('draft attribute value contracts', () => {
  it.each([
    [0, 'Text'],
    [1, 'Long text'],
    [2, 0],
    [8, 0.25],
    [6, false],
  ])('accepts supplied kind %s without coercion', (type, value) => {
    expect(validateAttributeValue(attribute(Number(type)), value)).toBeNull();
  });
  it.each([
    0, 1, 2, 3, 4, 5, 6, 7, 8,
  ])('requires an explicit value for mandatory kind %s', (type) => {
    expect(validateAttributeValue(attribute(type), undefined)).not.toBeNull();
  });
  it('keeps an unset boolean distinct from false and rejects string coercion', () => {
    expect(validateAttributeValue(attribute(6), false)).toBeNull();
    expect(validateAttributeValue(attribute(6), 'false')).not.toBeNull();
  });
  it('validates numeric integer, finite, positivity and precision boundaries', () => {
    expect(validateAttributeValue(attribute(2), '2')).not.toBeNull();
    expect(validateAttributeValue(attribute(2), 2.2)).not.toBeNull();
    expect(validateAttributeValue(attribute(8), Number.NaN)).not.toBeNull();
    expect(
      validateAttributeValue(
        attribute(8, {
          validations: { decimalPlaces: 2, notZeroOrNegative: true },
        }),
        0
      )
    ).not.toBeNull();
    expect(
      validateAttributeValue(
        attribute(8, { validations: { decimalPlaces: 2 } }),
        1.234
      )
    ).not.toBeNull();
    expect(
      validateAttributeValue(
        attribute(8, { validations: { decimalPlaces: 2 } }),
        1.23
      )
    ).toBeNull();
  });
  it('honors text bounds and null validation metadata', () => {
    expect(
      validateAttributeValue(
        attribute(0, { validations: { minLength: 2, maxLength: 3 } }),
        'a'
      )
    ).not.toBeNull();
    expect(
      validateAttributeValue(
        attribute(1, { validations: { maxLength: 3 } }),
        'abcd'
      )
    ).not.toBeNull();
    expect(
      validateAttributeValue(
        attribute(0, { validations: { maxLength: null, minLength: null } }),
        'ok'
      )
    ).toBeNull();
  });
  it('retains numeric option identities and rejects inactive, deleted and unknown choices', () => {
    const options = [
      option,
      { ...option, id: 11, status: 'INACTIVE' as const },
      { ...option, id: 12, status: 'DELETED' as const },
    ];
    expect(validateAttributeValue(attribute(4, { options }), 10)).toBeNull();
    expect(validateAttributeValue(attribute(3, { options }), [10])).toBeNull();
    for (const value of ['10', 11, 12, 99])
      expect(
        validateAttributeValue(attribute(4, { options }), value)
      ).not.toBeNull();
    expect(
      validateAttributeValue(attribute(3, { options }), [10, 10])
    ).not.toBeNull();
  });
  it('requires format/options for required controls while optional unavailable metadata can be omitted', () => {
    for (const type of [3, 4, 5, 7, 99]) {
      expect(attributeUnavailableReason(attribute(type))).not.toBeNull();
      expect(validateAttributeValue(attribute(type), 'made-up')).not.toBeNull();
      expect(
        validateAttributeValue(attribute(type, { mandatory: false }), undefined)
      ).toBeNull();
    }
  });
  it('accepts exact documented date formats and rejects invalid calendar dates and silent normalization', () => {
    const date = attribute(5, { validations: { dateFormat: 'YYYY-MM-DD' } });
    expect(validateAttributeValue(date, '2026-02-28')).toBeNull();
    for (const invalid of ['2026-02-30', '2026-2-01', '02/01/2026'])
      expect(validateAttributeValue(date, invalid)).not.toBeNull();
    const datetime = attribute(7, {
      validations: { dateFormat: 'YYYY-MM-DDTHH:mm:ss' },
    });
    expect(validateAttributeValue(datetime, '2026-02-28T12:30:00')).toBeNull();
    for (const invalid of [
      '2026-02-28T25:30:00',
      '2026-02-28T12:30',
      '2026-02-28T12:30:00Z',
    ])
      expect(validateAttributeValue(datetime, invalid)).not.toBeNull();
    expect(
      attributeUnavailableReason(
        attribute(5, { validations: { dateFormat: 'unknown' } })
      )
    ).not.toBeNull();
  });
});
