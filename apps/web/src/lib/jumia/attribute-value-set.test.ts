import { describe, expect, it } from 'vitest';
import { validateJumiaAttributeValueSet } from './attribute-value-set';
import type { JumiaDraftAttribute } from './attribute-values';
import { prepareJumiaListingContent } from './listing-content';

const attribute = (
  type: number,
  extra: Partial<JumiaDraftAttribute> = {}
): JumiaDraftAttribute => ({
  code: 1,
  name: 'value',
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

describe('whole Jumia metadata and typed value validation', () => {
  it.each([
    [0, '  exact text  ', {}],
    [1, '<b>literal text</b>', {}],
    [2, 0, {}],
    [3, [10], { options: [option] }],
    [4, 10, { options: [option] }],
    [5, '2024-02-29', { validations: { dateFormat: 'YYYY-MM-DD' } }],
    [6, false, {}],
    [
      7,
      '2026-01-01T12:30',
      { validations: { dateFormat: 'YYYY-MM-DDTHH:mm' } },
    ],
    [8, 125.5, { validations: { percentage: true } }],
  ])('preserves supplied kind %s byte-for-byte, not as provider strings', (type, value, extra) => {
    const result = validateJumiaAttributeValueSet([attribute(type, extra)], {
      '1': value,
    });
    expect(result).toEqual({ success: true, values: { '1': value } });
  });

  it('omits optional unavailable attributes without selectedByDefault synthesis', () => {
    const definitions = [
      attribute(99, { mandatory: false }),
      attribute(6, {
        code: 2,
        name: 'other',
        mandatory: false,
        validations: { selectedByDefault: true },
      }),
    ];
    expect(validateJumiaAttributeValueSet(definitions, {})).toEqual({
      success: true,
      values: {},
    });
    expect(
      validateJumiaAttributeValueSet([attribute(0, { mandatory: false })], {
        '1': undefined,
      })
    ).toEqual({ success: true, values: {} });
    expect(
      validateJumiaAttributeValueSet(definitions, { '1': 'invented' })
    ).toMatchObject({ success: false, errors: [{ field: 'values.1' }] });
  });

  it('preserves accepted explicit optional empty values rather than stripping them', () => {
    expect(
      validateJumiaAttributeValueSet([attribute(0, { mandatory: false })], {
        '1': '',
      })
    ).toEqual({ success: true, values: { '1': '' } });
    expect(
      validateJumiaAttributeValueSet(
        [attribute(3, { mandatory: false, options: [option] })],
        { '1': [] }
      )
    ).toEqual({ success: true, values: { '1': [] } });
  });
  it('rejects even empty supplied values for unsupported optional metadata', () => {
    expect(
      validateJumiaAttributeValueSet([attribute(99, { mandatory: false })], {
        '1': '',
      }).success
    ).toBe(false);
    expect(
      validateJumiaAttributeValueSet([attribute(99, { mandatory: false })], {
        '1': [],
      }).success
    ).toBe(false);
  });
  it.each([
    [0, []],
    [1, []],
    [2, ''],
    [2, []],
    [3, ''],
    [4, ''],
    [4, []],
    [5, ''],
    [5, []],
    [6, ''],
    [6, []],
    [7, ''],
    [7, []],
    [8, ''],
    [8, []],
  ])('rejects wrong-type empty values for optional kind %s', (type, value) => {
    const extra =
      type === 5
        ? { dateFormat: 'YYYY-MM-DD' }
        : { dateFormat: 'YYYY-MM-DDTHH:mm:ss' };
    expect(
      validateJumiaAttributeValueSet(
        [
          attribute(type, {
            mandatory: false,
            options: [option],
            validations: extra,
          }),
        ],
        { '1': value }
      ).success
    ).toBe(false);
  });
  it('does not execute selection accessors or accept inherited nested metadata', () => {
    const choices = [10];
    Object.defineProperty(choices, '0', {
      get: () => {
        throw new Error('Accessor must not execute');
      },
      enumerable: true,
    });
    expect(
      validateJumiaAttributeValueSet([attribute(3, { options: [option] })], {
        '1': choices,
      }).success
    ).toBe(false);
    const translations = [
      Object.create({ languageCode: 'EN', translation: 'inherited' }),
    ];
    expect(
      validateJumiaAttributeValueSet([attribute(0, { translations })], {
        '1': 'value',
      }).success
    ).toBe(false);
  });
  it.each([
    [0, ' ', {}],
    [0, 'a', { validations: { minLength: 2 } }],
    [1, 'abcd', { validations: { maxLength: 3 } }],
    [2, '1', {}],
    [2, 1.2, {}],
    [8, Number.POSITIVE_INFINITY, {}],
    [8, Number.NaN, {}],
    [8, -1, { validations: { notZeroOrNegative: true } }],
    [8, 1.234, { validations: { decimalPlaces: 2 } }],
    [6, 'false', {}],
    [4, [10], { options: [option] }],
    [3, 10, { options: [option] }],
    [3, [10, 10], { options: [option] }],
    [4, 11, { options: [option] }],
    [4, 10, { options: [{ ...option, status: 'INACTIVE' as const }] }],
    [3, [10], { options: [{ ...option, status: 'DELETED' as const }] }],
    [5, '2026-02-29', { validations: { dateFormat: 'YYYY-MM-DD' } }],
    [5, '2026-01-01', { validations: { dateFormat: 'DD/MM/YYYY' } }],
    [
      7,
      '2026-01-01T24:00:00',
      { validations: { dateFormat: 'YYYY-MM-DDTHH:mm:ss' } },
    ],
    [99, 'text', {}],
  ])('rejects invalid kind %s values without coercion', (type, value, extra) => {
    expect(
      validateJumiaAttributeValueSet([attribute(type, extra)], { '1': value })
        .success
    ).toBe(false);
  });

  it.each([
    0, 1, 2, 3, 4, 5, 6, 7, 8, 99,
  ])('requires a value for mandatory type %s', (type) => {
    expect(validateJumiaAttributeValueSet([attribute(type)], {}).success).toBe(
      false
    );
  });

  it('rejects unknown keys in stable order and returns all required field errors, never partial values', () => {
    const result = validateJumiaAttributeValueSet(
      [attribute(6), attribute(0, { code: 2, name: 'other' })],
      { z: 'unsafe', a: 'unsafe' }
    );
    expect(result).toMatchObject({ success: false });
    if (result.success) throw new Error('Invalid set must fail');
    expect(result.errors.map((error) => error.field)).toEqual([
      'values.a',
      'values.z',
      'values.1',
      'values.2',
    ]);
    expect(result).not.toHaveProperty('values');
  });

  it.each(
    [
      [attribute(0), attribute(0, { name: 'other' })],
      [attribute(0), attribute(0, { code: 2, name: ' Value ' })],
      [attribute(0, { name: '' })],
      [attribute(0, { code: Number.NaN })],
      [{ ...attribute(0), mandatory: undefined }],
      [attribute(0, { validations: { minLength: -1 } })],
      [attribute(0, { validations: { minLength: 4, maxLength: 2 } })],
      [attribute(8, { validations: { decimalPlaces: 101 } })],
      [
        attribute(4, {
          options: [option, { ...option, status: 'INACTIVE' as const }],
        }),
      ],
      [Object.create(attribute(0))],
      [attribute(0, { validations: Object.create({ minLength: 10 }) })],
    ].map((definitions: unknown[]) => ({ definitions }))
  )('fails closed on malformed or ambiguous metadata $definitions', ({
    definitions,
  }) => {
    expect(
      validateJumiaAttributeValueSet(definitions, { '1': 'text' }).success
    ).toBe(false);
  });

  it.each([
    null,
    [],
    Object.create({ '1': 'inherited' }),
    { toString: 'unknown' },
    JSON.parse('{"__proto__":"unknown"}'),
  ])('rejects invalid containers and inherited/unknown values %j', (values) => {
    expect(validateJumiaAttributeValueSet([attribute(0)], values).success).toBe(
      false
    );
  });
  it('rejects inherited numeric array members rather than accepting prototype facts', () => {
    const choices = new Array<number>(1);
    Object.setPrototypeOf(choices, { 0: 10, __proto__: Array.prototype });
    expect(
      validateJumiaAttributeValueSet([attribute(3, { options: [option] })], {
        '1': choices,
      }).success
    ).toBe(false);
  });
  it('accepts a plain null-prototype dictionary without filling omissions', () => {
    const values: Record<string, string> = Object.create(null);
    values['1'] = 'exact';
    expect(validateJumiaAttributeValueSet([attribute(0)], values)).toEqual({
      success: true,
      values: { '1': 'exact' },
    });
  });
  it('does not treat prepared content as fulfillment of required attribute definitions', () => {
    expect(
      prepareJumiaListingContent({
        title: 'Factual product name',
        description: 'Supplied description',
        bullets: ['1', '2', '3', '4'],
        weight: { value: 1, unit: 'kg' },
      }).success
    ).toBe(true);
    expect(
      validateJumiaAttributeValueSet(
        [attribute(0, { name: 'description' })],
        {}
      )
    ).toMatchObject({ success: false, errors: [{ field: 'values.1' }] });
    expect(
      validateJumiaAttributeValueSet([attribute(0, { name: 'description' })], {
        '1': 'Supplied description',
      }).success
    ).toBe(true);
  });
});
