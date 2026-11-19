import { describe, expect, it } from 'vitest';
import {
  JumiaAttributeSetResponseSchema,
  JumiaCategoriesResponseSchema,
  JumiaCategorySchema,
} from '@/schemas/jumia';
import {
  documentedAttributes,
  documentedCategories,
} from './catalog.test-fixtures.json';

// Public examples and field requirements, verified 2026-10-24:
// https://vendorcenter.jumia.com/api-docs/paths/catalog/catalog@categories.yaml
// https://vendorcenter.jumia.com/api-docs/paths/catalog/catalog@attribute-sets@{id}.yaml
const coreAttribute = {
  code: 1000256,
  name: 'age_range',
  description: 'Age Range',
  type: 0,
  mandatory: false,
  variation: false,
  translatable: false,
};
const option = documentedAttributes.attributes[1].options?.[0];

function parseAttribute(attribute: unknown) {
  return JumiaAttributeSetResponseSchema.parse({ attributes: [attribute] })
    .attributes[0];
}

function acceptsAttribute(attribute: unknown) {
  return JumiaAttributeSetResponseSchema.safeParse({ attributes: [attribute] })
    .success;
}

describe('documented Jumia category contract', () => {
  it('preserves numeric codes, sid, hierarchy and required pagination', () => {
    expect(JumiaCategoriesResponseSchema.parse(documentedCategories)).toEqual(
      documentedCategories
    );
  });

  it.each([
    { hasChildren: undefined },
    { hasChildren: 'false' },
    { code: '1000052' },
    { completePath: undefined },
    { attributeSet: { id: 'legacy-id', name: 'Books' } },
    { attributeSet: { sid: 'invalid-uuid', name: 'Books' } },
    {
      attributeSet: {
        sid: documentedCategories.categories[0].attributeSet.sid,
      },
    },
  ])('rejects malformed required category evidence: %j', (change) => {
    expect(
      JumiaCategorySchema.safeParse({
        ...documentedCategories.categories[0],
        ...change,
      }).success
    ).toBe(false);
  });

  it.each([
    undefined,
    {},
    { current: 1 },
    { totalOfPages: 42 },
    { current: 1.5, totalOfPages: 42 },
  ])('rejects missing or malformed pagination: %j', (page) => {
    expect(
      JumiaCategoriesResponseSchema.safeParse({ categories: [], page }).success
    ).toBe(false);
  });
});

describe('documented Jumia attribute-set contract', () => {
  it('accepts the published response including omitted optional metadata', () => {
    expect(JumiaAttributeSetResponseSchema.parse(documentedAttributes)).toEqual(
      documentedAttributes
    );
    expect(parseAttribute(coreAttribute)).toEqual(coreAttribute);
  });

  it.each([
    0, 1, 2, 3, 4, 5, 6, 7, 8,
  ])('preserves supported numeric type %i', (type) => {
    expect(parseAttribute({ ...coreAttribute, type }).type).toBe(type);
  });

  it.each([
    -1,
    9,
    1.5,
    '0',
    'TEXT',
    'option',
    null,
    undefined,
  ])('rejects unknown, noninteger or obsolete string type %j', (type) => {
    expect(acceptsAttribute({ ...coreAttribute, type })).toBe(false);
  });

  it.each([
    'code',
    'name',
    'description',
    'type',
    'mandatory',
    'variation',
    'translatable',
  ])('requires core attribute evidence %s', (field) => {
    expect(acceptsAttribute({ ...coreAttribute, [field]: undefined })).toBe(
      false
    );
  });

  it('preserves optional validations with null, false and zero values', () => {
    const validations = {
      dateFormat: null,
      decimalPlaces: 0,
      maxLength: null,
      minLength: 0,
      percentage: false,
      notZeroOrNegative: false,
      selectedByDefault: null,
    };
    expect(
      parseAttribute({ ...coreAttribute, validations }).validations
    ).toEqual(validations);
    expect(
      parseAttribute({ ...coreAttribute, validations: {} }).validations
    ).toEqual({});
  });

  it.each([
    {
      dateFormat: null,
      decimalPlaces: null,
      maxLength: null,
      minLength: null,
      percentage: null,
      notZeroOrNegative: null,
      selectedByDefault: null,
    },
    {
      dateFormat: 'YYYY-MM-DD',
      decimalPlaces: 2,
      maxLength: 50,
      minLength: 1,
      percentage: true,
      notZeroOrNegative: true,
      selectedByDefault: false,
    },
  ])('preserves every documented validation field: %j', (validations) => {
    expect(
      parseAttribute({ ...coreAttribute, validations }).validations
    ).toEqual(validations);
  });

  it.each([
    { dateFormat: 1 },
    { decimalPlaces: '0' },
    { maxLength: false },
    { minLength: '1' },
    { percentage: 0 },
    { notZeroOrNegative: 'false' },
    { selectedByDefault: 1 },
    [],
    null,
  ])('rejects malformed validations %j', (validations) => {
    expect(acceptsAttribute({ ...coreAttribute, validations })).toBe(false);
  });

  it('accepts attribute translations without languageId and retains present fields', () => {
    const translations = [{ languageCode: 'FR', translation: 'Age' }];
    expect(
      parseAttribute({ ...coreAttribute, translations }).translations
    ).toEqual(translations);
  });

  it.each([
    { sid: 'invalid-uuid' },
    { sid: null },
    { translations: [{ languageCode: 'FR' }] },
    { translations: [{ translation: 'Age' }] },
    {
      translations: [
        { languageCode: 'FR', translation: 'Age', languageId: '1' },
      ],
    },
    { options: null },
    { mandatory: 'false' },
    { variation: 0 },
    { translatable: null },
  ])('rejects malformed present attribute fields %j', (change) => {
    expect(acceptsAttribute({ ...coreAttribute, ...change })).toBe(false);
  });

  it.each([
    'ACTIVE',
    'INACTIVE',
    'DELETED',
  ])('preserves numeric option IDs, UUID sid, and status %s', (status) => {
    const translations = [
      {},
      { languageId: 0 },
      { languageCode: 'FR', translation: 'Numerique' },
    ];
    const value = { ...option, position: 0, status, translations };
    expect(
      parseAttribute({ ...coreAttribute, options: [value] }).options
    ).toEqual([value]);
  });

  it('permits omitted option translations', () => {
    const { translations: _, ...withoutTranslations } =
      documentedAttributes.attributes[1].options?.[0] ?? {};
    expect(
      acceptsAttribute({ ...coreAttribute, options: [withoutTranslations] })
    ).toBe(true);
  });

  it.each([
    'id',
    'sid',
    'name',
    'position',
    'isDefault',
    'status',
  ])('requires option evidence %s', (field) => {
    expect(
      acceptsAttribute({
        ...coreAttribute,
        options: [{ ...option, [field]: undefined }],
      })
    ).toBe(false);
  });

  it.each([
    { id: '5241' },
    { sid: 'invalid-uuid' },
    { status: 'active' },
    { position: '0' },
    { isDefault: 0 },
    { translations: [{ languageId: '1' }] },
    { translations: [{ languageCode: null }] },
    { translations: [{ translation: 1 }] },
  ])('rejects malformed option evidence %j', (change) => {
    expect(
      acceptsAttribute({
        ...coreAttribute,
        options: [{ ...option, ...change }],
      })
    ).toBe(false);
  });
});
