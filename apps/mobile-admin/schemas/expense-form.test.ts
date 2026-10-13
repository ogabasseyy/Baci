import { describe, expect, it } from 'vitest';
import { createExpenseEditFormSchema, ExpenseFormSchema } from './expense-form';

const validExpenseForm = {
  amount: 12_500,
  branchId: 'e65327d2-466d-4adb-a13d-2f7a4b1d5529',
  category: 'Inventory',
  date: '2026-08-09',
  description: ' Office internet ',
  groupId: '7acf0b9c-c3bd-4e22-833e-098b378f84cd',
  paymentMethod: ' Bank transfer ',
  reference: ' INV-123 ',
  vendorName: ' Internet provider ',
};

describe('ExpenseFormSchema', () => {
  it('accepts only editable expense values and trims optional text', () => {
    expect(ExpenseFormSchema.parse(validExpenseForm)).toEqual({
      ...validExpenseForm,
      description: 'Office internet',
      paymentMethod: 'Bank transfer',
      reference: 'INV-123',
      vendorName: 'Internet provider',
    });
  });

  it('allows a nullable group and metadata fields', () => {
    expect(
      ExpenseFormSchema.parse({
        ...validExpenseForm,
        description: null,
        groupId: null,
        paymentMethod: null,
        reference: null,
        vendorName: null,
      })
    ).toMatchObject({
      description: null,
      groupId: null,
      paymentMethod: null,
      reference: null,
      vendorName: null,
    });
  });

  it('normalizes whitespace-only optional metadata to null', () => {
    expect(
      ExpenseFormSchema.parse({
        ...validExpenseForm,
        description: '   ',
        paymentMethod: '\t',
        reference: '  ',
        vendorName: '\n',
      })
    ).toMatchObject({
      description: null,
      paymentMethod: null,
      reference: null,
      vendorName: null,
    });
  });

  it('accepts optional text at its exact maximum lengths', () => {
    expect(
      ExpenseFormSchema.parse({
        ...validExpenseForm,
        description: 'a'.repeat(500),
        paymentMethod: 'b'.repeat(120),
        reference: 'c'.repeat(120),
        vendorName: 'd'.repeat(120),
      })
    ).toMatchObject({
      description: 'a'.repeat(500),
      paymentMethod: 'b'.repeat(120),
      reference: 'c'.repeat(120),
      vendorName: 'd'.repeat(120),
    });
  });

  it('rejects non-positive and non-finite amounts', () => {
    expect(() =>
      ExpenseFormSchema.parse({ ...validExpenseForm, amount: 0 })
    ).toThrow();
    expect(() =>
      ExpenseFormSchema.parse({
        ...validExpenseForm,
        amount: Number.POSITIVE_INFINITY,
      })
    ).toThrow();
  });

  it('rejects malformed calendar dates, groups, and categories', () => {
    expect(() =>
      ExpenseFormSchema.parse({ ...validExpenseForm, date: '2026-02-29' })
    ).toThrow();
    expect(() =>
      ExpenseFormSchema.parse({ ...validExpenseForm, groupId: 'group-1' })
    ).toThrow();
    expect(() =>
      ExpenseFormSchema.parse({ ...validExpenseForm, category: 'Office' })
    ).toThrow();
  });

  it('preserves an unchanged legacy category during edit validation', () => {
    expect(
      createExpenseEditFormSchema(null, 'Legacy category').safeParse({
        ...validExpenseForm,
        category: 'Legacy category',
      }).success
    ).toBe(true);
  });

  it('preserves an unchanged legacy amount during edit validation', () => {
    const legacy = createExpenseEditFormSchema(null, 'Inventory', 0).safeParse({
      ...validExpenseForm,
      amount: 0,
    });
    expect(legacy.success).toBe(true);
    expect(
      createExpenseEditFormSchema(null, 'Inventory', 0).safeParse({
        ...validExpenseForm,
        amount: -1,
      }).success
    ).toBe(false);
  });

  it('preserves an unchanged unassigned branch during edit validation', () => {
    const result = createExpenseEditFormSchema(
      null,
      'Inventory',
      12,
      null
    ).safeParse({
      ...validExpenseForm,
      amount: 12,
      branchId: null,
    });

    expect(result.success).toBe(true);
  });

  it('rejects overlong metadata and persisted receipt fields', () => {
    expect(() =>
      ExpenseFormSchema.parse({
        ...validExpenseForm,
        description: 'a'.repeat(501),
      })
    ).toThrow();
    expect(() =>
      ExpenseFormSchema.parse({
        ...validExpenseForm,
        vendorName: 'a'.repeat(121),
      })
    ).toThrow();
    expect(() =>
      ExpenseFormSchema.parse({
        ...validExpenseForm,
        paymentMethod: 'a'.repeat(121),
      })
    ).toThrow();
    expect(() =>
      ExpenseFormSchema.parse({
        ...validExpenseForm,
        reference: 'a'.repeat(121),
      })
    ).toThrow();
    expect(() =>
      ExpenseFormSchema.parse({
        ...validExpenseForm,
        receipt_storage_path: 'merchant-1/expenses/receipt.jpg',
      })
    ).toThrow();
    expect(() =>
      ExpenseFormSchema.parse({
        ...validExpenseForm,
        receipt_url: 'https://example.com/receipt.jpg',
      })
    ).toThrow();
    expect(() =>
      ExpenseFormSchema.parse({
        ...validExpenseForm,
        updated_at: '2026-08-09T12:00:00.000Z',
      })
    ).toThrow();
    expect(() =>
      ExpenseFormSchema.parse({
        ...validExpenseForm,
        created_by_user_id: 'user-1',
      })
    ).toThrow();
  });

  it('allows an unchanged historical long description but rejects changing it', () => {
    const legacyDescription = 'a'.repeat(501);
    const editSchema = createExpenseEditFormSchema(
      legacyDescription,
      'Inventory'
    );

    expect(
      editSchema.parse({ ...validExpenseForm, description: legacyDescription })
        .description
    ).toBe(legacyDescription);
    expect(() =>
      editSchema.parse({
        ...validExpenseForm,
        description: `${legacyDescription}!`,
      })
    ).toThrow('Description must be 500 characters or fewer');
  });
});
