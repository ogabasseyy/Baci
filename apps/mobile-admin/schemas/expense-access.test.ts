import { describe, expect, it } from 'vitest';
import { ExpenseAccessRowSchema, resolveExpenseAccess } from './expense-access';

const merchantId = '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e';

const staffAccessRow = {
  is_owner: false,
  is_staff: true,
  merchant_id: merchantId,
  permissions: {},
  role: 'accountant',
};

describe('ExpenseAccessRowSchema', () => {
  it('parses the get_user_access row used to authorize an owner', () => {
    expect(
      ExpenseAccessRowSchema.parse({
        ...staffAccessRow,
        is_owner: true,
        is_staff: false,
        permissions: { '*': { '*': true } },
        role: 'owner',
      })
    ).toMatchObject({
      merchant_id: merchantId,
      permissions: { '*': { '*': true } },
    });
  });

  it('ignores malformed expense grants without rejecting unrelated legacy permissions', () => {
    expect(
      ExpenseAccessRowSchema.parse({
        ...staffAccessRow,
        permissions: {
          expenses: { view: 'allowed' },
          unsafe: { value: 'never-copy' },
        },
      }).permissions
    ).toEqual({});
    expect(
      resolveExpenseAccess(
        ExpenseAccessRowSchema.parse({
          ...staffAccessRow,
          permissions: {
            expenses: { view: true, create: true, edit: true },
            unsafe: { value: 'never-copy' },
          },
        })
      )
    ).toEqual({
      canCreate: true,
      canEdit: true,
      canManageIntegrations: false,
      canView: true,
    });
  });

  it('normalizes supported string boolean overrides from the access RPC', () => {
    expect(
      ExpenseAccessRowSchema.parse({
        ...staffAccessRow,
        permissions: {
          orders: { edit: 'true' },
          expenses: { view: 'true', create: 'false' },
        },
      }).permissions
    ).toEqual({
      expenses: { view: true, create: false },
    });
  });

  it.each([
    ['TRUE', true],
    ['On', true],
    ['t', true],
    ['yes', true],
    ['on', true],
    ['1', true],
    [1, true],
    ['FALSE', false],
    ['Off', false],
    ['f', false],
    ['no', false],
    ['off', false],
    ['0', false],
    [0, false],
  ])('normalizes PostgreSQL boolean spelling %s', (value, expected) => {
    expect(
      ExpenseAccessRowSchema.parse({
        ...staffAccessRow,
        permissions: { expenses: { view: value } },
      }).permissions.expenses?.view
    ).toBe(expected);
  });

  it('rejects undeclared access response fields', () => {
    expect(() =>
      ExpenseAccessRowSchema.parse({
        ...staffAccessRow,
        stale: true,
      })
    ).toThrow();
  });
});

describe('resolveExpenseAccess', () => {
  it.each([
    ['*.*', { '*': { '*': true } }, true],
    ['*.action', { '*': { create: true, edit: true, view: true } }, false],
    ['expenses.*', { expenses: { '*': true } }, false],
    [
      'expenses.action',
      { expenses: { create: true, edit: true, view: true } },
      false,
    ],
    ['expenses.all', { expenses: { all: true } }, false],
    ['full_access.all', { full_access: { all: true } }, true],
  ])('grants each database-supported wildcard form: %s', (_name, permissions, canManageIntegrations) => {
    expect(
      resolveExpenseAccess(
        ExpenseAccessRowSchema.parse({ ...staffAccessRow, permissions })
      )
    ).toEqual({
      canCreate: true,
      canEdit: true,
      canManageIntegrations,
      canView: true,
    });
  });

  it('keeps the first non-null false grant ahead of later true grants', () => {
    expect(
      resolveExpenseAccess(
        ExpenseAccessRowSchema.parse({
          ...staffAccessRow,
          permissions: {
            '*': { '*': false },
            expenses: { create: true, edit: true, view: true },
            full_access: { all: true },
          },
        })
      )
    ).toEqual({
      canCreate: false,
      canEdit: false,
      canManageIntegrations: false,
      canView: false,
    });
  });

  it.each([
    [
      '*.action',
      {
        '*': { view: false },
        expenses: { edit: true, view: true },
        full_access: { all: true },
      },
      {
        canCreate: true,
        canEdit: false,
        canManageIntegrations: true,
        canView: false,
      },
    ],
    [
      'expenses.*',
      {
        expenses: { '*': false, create: true, edit: true, view: true },
        full_access: { all: true },
      },
      {
        canCreate: false,
        canEdit: false,
        canManageIntegrations: true,
        canView: false,
      },
    ],
    [
      'expenses.action',
      {
        expenses: { all: true, create: false, edit: false, view: false },
        full_access: { all: true },
      },
      {
        canCreate: false,
        canEdit: false,
        canManageIntegrations: true,
        canView: false,
      },
    ],
    [
      'expenses.all',
      {
        expenses: { all: false },
        full_access: { all: true },
      },
      {
        canCreate: false,
        canEdit: false,
        canManageIntegrations: true,
        canView: false,
      },
    ],
  ])('keeps an explicit false at %s ahead of later true grants', (_location, permissions, expectedAccess) => {
    expect(
      resolveExpenseAccess(
        ExpenseAccessRowSchema.parse({ ...staffAccessRow, permissions })
      )
    ).toEqual(expectedAccess);
  });

  it('denies editing when the edit grant lacks the visibility required by UPDATE', () => {
    expect(
      resolveExpenseAccess(
        ExpenseAccessRowSchema.parse({
          ...staffAccessRow,
          permissions: { expenses: { edit: true, view: false } },
        })
      )
    ).toEqual({
      canCreate: false,
      canEdit: false,
      canManageIntegrations: false,
      canView: false,
    });
  });

  it('allows owners and staff with integrations.manage to edit payout settings', () => {
    expect(
      resolveExpenseAccess(
        ExpenseAccessRowSchema.parse({
          ...staffAccessRow,
          is_owner: true,
          is_staff: false,
          permissions: {},
          role: 'owner',
        })
      ).canManageIntegrations
    ).toBe(true);

    expect(
      resolveExpenseAccess(
        ExpenseAccessRowSchema.parse({
          ...staffAccessRow,
          permissions: { integrations: { manage: true } },
        })
      ).canManageIntegrations
    ).toBe(true);
  });
});
