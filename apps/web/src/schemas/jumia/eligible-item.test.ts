import { describe, expect, it } from 'vitest';
import { jumiaProductExportEligibleItemSchema } from './eligible-item';

const validItem = {
  id: 'item-1',
  available: true,
  unavailableReason: null,
  capturedSourceVersion: 'v1',
  currentSourceVersion: 'v1',
  product: { product: { name: 'Controller' } },
};

function withoutField(record: object, field: string) {
  const result: Record<string, unknown> = { ...record };
  delete result[field];
  return result;
}

describe('jumiaProductExportEligibleItemSchema', () => {
  it('parses valid available and unavailable items', () => {
    expect(jumiaProductExportEligibleItemSchema.parse(validItem)).toEqual(
      validItem
    );
    expect(
      jumiaProductExportEligibleItemSchema.parse({
        ...validItem,
        available: false,
        unavailableReason: 'inactive',
        currentSourceVersion: null,
        product: null,
      })
    ).toMatchObject({ available: false, product: null });
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

  it('enforces identifier and nested product-name boundaries', () => {
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
    expect(
      jumiaProductExportEligibleItemSchema.safeParse({
        ...validItem,
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
  });
});
