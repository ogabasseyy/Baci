import { describe, expect, it } from 'vitest';
import {
  jumiaProductExportEligibleItemSchema,
  jumiaProductExportEligiblePageSchema,
} from './eligible-page';

const validItem = {
  id: 'item-1',
  available: true,
  unavailableReason: null,
  capturedSourceVersion: 'v1',
  currentSourceVersion: 'v1',
  product: { product: { name: 'Controller' } },
};

const validPage = {
  selectionId: 'selection-1',
  total: 1,
  page: 1,
  totalPages: 1,
  legacyUnmappedCount: 0,
  products: [validItem],
};

function withoutField(record: object, field: string) {
  const result: Record<string, unknown> = { ...record };
  delete result[field];
  return result;
}

describe('jumiaProductExportEligibleItemSchema', () => {
  it('parses a valid available item and preserves optional product data', () => {
    expect(jumiaProductExportEligibleItemSchema.parse(validItem)).toEqual(
      validItem
    );
  });

  it.each([
    'id',
    'available',
    'unavailableReason',
    'capturedSourceVersion',
    'currentSourceVersion',
    'product',
  ])('rejects an item missing required field %s', (field) => {
    expect(
      jumiaProductExportEligibleItemSchema.safeParse(
        withoutField(validItem, field)
      ).success
    ).toBe(false);
  });

  it.each([
    ['id', 1],
    ['available', 'true'],
    ['unavailableReason', false],
    ['capturedSourceVersion', 1],
    ['currentSourceVersion', 1],
    ['product', 'Controller'],
  ])('rejects a wrong type for item field %s', (field, value) => {
    expect(
      jumiaProductExportEligibleItemSchema.safeParse({
        ...validItem,
        [field]: value,
      }).success
    ).toBe(false);
  });

  it('accepts nullable source and product fields and rejects empty identifiers', () => {
    expect(
      jumiaProductExportEligibleItemSchema.safeParse({
        ...validItem,
        unavailableReason: 'missing category mapping',
        currentSourceVersion: null,
        product: null,
      }).success
    ).toBe(true);
    expect(
      jumiaProductExportEligibleItemSchema.safeParse({
        ...validItem,
        unavailableReason: null,
        currentSourceVersion: '',
      }).success
    ).toBe(false);
    expect(
      jumiaProductExportEligibleItemSchema.safeParse({
        ...validItem,
        product: { product: { name: 1 } },
      }).success
    ).toBe(false);
    expect(
      jumiaProductExportEligibleItemSchema.safeParse({
        ...validItem,
        product: { product: {} },
      }).success
    ).toBe(true);
    expect(
      jumiaProductExportEligibleItemSchema.safeParse({
        ...validItem,
        id: '',
      }).success
    ).toBe(false);
    expect(
      jumiaProductExportEligibleItemSchema.safeParse({
        ...validItem,
        capturedSourceVersion: '',
      }).success
    ).toBe(false);
  });
});

describe('jumiaProductExportEligiblePageSchema', () => {
  it('parses a valid page including an empty product list', () => {
    expect(jumiaProductExportEligiblePageSchema.parse(validPage)).toEqual(
      validPage
    );
    expect(
      jumiaProductExportEligiblePageSchema.safeParse({
        ...validPage,
        total: 0,
        totalPages: 0,
        products: [],
      }).success
    ).toBe(true);
  });

  it.each([
    'selectionId',
    'total',
    'page',
    'totalPages',
    'legacyUnmappedCount',
    'products',
  ])('rejects a page missing required field %s', (field) => {
    expect(
      jumiaProductExportEligiblePageSchema.safeParse(
        withoutField(validPage, field)
      ).success
    ).toBe(false);
  });

  it.each([
    ['selectionId', 1],
    ['total', '1'],
    ['page', '1'],
    ['totalPages', '1'],
    ['legacyUnmappedCount', '0'],
    ['products', {}],
  ])('rejects a wrong type for page field %s', (field, value) => {
    expect(
      jumiaProductExportEligiblePageSchema.safeParse({
        ...validPage,
        [field]: value,
      }).success
    ).toBe(false);
  });

  it.each([
    ['total', -1],
    ['page', 0],
    ['totalPages', -1],
    ['legacyUnmappedCount', -1],
    ['total', 1.5],
    ['page', 1.5],
    ['totalPages', 1.5],
    ['legacyUnmappedCount', 1.5],
  ])('rejects an out-of-range page value for %s', (field, value) => {
    expect(
      jumiaProductExportEligiblePageSchema.safeParse({
        ...validPage,
        [field]: value,
      }).success
    ).toBe(false);
  });

  it('rejects empty selection identifiers and non-object product entries', () => {
    expect(
      jumiaProductExportEligiblePageSchema.safeParse({
        ...validPage,
        selectionId: '',
      }).success
    ).toBe(false);
    expect(
      jumiaProductExportEligiblePageSchema.safeParse({
        ...validPage,
        products: [null],
      }).success
    ).toBe(false);
  });
});
