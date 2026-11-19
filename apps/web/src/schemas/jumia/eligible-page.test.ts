import { describe, expect, it } from 'vitest';
import { jumiaProductExportEligiblePageSchema } from './eligible-page';

const validItem = {
  id: 'item-1',
  available: true,
  unavailableReason: null,
  capturedSourceVersion: 'v1',
  currentSourceVersion: 'v1',
  product: { product: { name: 'Controller' } },
};

const validPage = {
  selectionId: 'd1ef9f3a-4f2b-49af-a84f-97d19c0084bd',
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

  it('rejects a non-UUID selection identifier', () => {
    expect(
      jumiaProductExportEligiblePageSchema.safeParse({
        ...validPage,
        selectionId: 'selection-1',
      }).success
    ).toBe(false);
  });
});
