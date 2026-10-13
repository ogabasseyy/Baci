import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanupLegacyExpenseReceipts } from './cleanup-legacy-expense-receipts.mjs';

const requiredEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
};

function createSupabaseMock({
  claimData = [],
  claimError = null,
  authorizeByPath = new Map(),
  completeByPath = new Map(),
  removeError = null,
} = {}) {
  const calls = [];
  const createSupabaseClient = () => ({
    rpc(name, params) {
      calls.push({ name, params });
      if (name === 'claim_legacy_expense_receipt_cleanup_candidates') {
        return Promise.resolve({ data: claimData, error: claimError });
      }
      if (name === 'authorize_legacy_expense_receipt_cleanup_deletion') {
        return Promise.resolve({
          data: authorizeByPath.get(params.p_storage_path) ?? true,
          error: null,
        });
      }
      if (name === 'complete_legacy_expense_receipt_cleanup') {
        return Promise.resolve({
          data: completeByPath.get(params.p_storage_path) ?? true,
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    storage: {
      from(bucket) {
        calls.push({ bucket });
        return {
          remove(paths) {
            calls.push({ operation: 'remove', paths });
            return Promise.resolve({ error: removeError });
          },
        };
      },
    },
  });

  return { calls, createSupabaseClient };
}

describe('cleanupLegacyExpenseReceipts', () => {
  it('claims, authorizes, removes media objects, and completes cleanup', async () => {
    const mock = createSupabaseMock({
      claimData: [
        {
          expense_id: 'expense-1',
          merchant_id: 'merchant-1',
          storage_path: 'expenses/merchant-1/receipt.pdf',
        },
      ],
    });
    const messages = [];

    const result = await cleanupLegacyExpenseReceipts({
      createSupabaseClient: mock.createSupabaseClient,
      env: requiredEnv,
      logger: { log: (message) => messages.push(message) },
    });

    assert.deepEqual(result, { removed: 1, skipped: 0, failed: 0 });
    assert.deepEqual(mock.calls, [
      {
        name: 'claim_legacy_expense_receipt_cleanup_candidates',
        params: { p_limit: 100 },
      },
      {
        name: 'authorize_legacy_expense_receipt_cleanup_deletion',
        params: {
          p_expense_id: 'expense-1',
          p_merchant_id: 'merchant-1',
          p_storage_path: 'expenses/merchant-1/receipt.pdf',
        },
      },
      { bucket: 'media' },
      {
        operation: 'remove',
        paths: ['expenses/merchant-1/receipt.pdf'],
      },
      {
        name: 'complete_legacy_expense_receipt_cleanup',
        params: {
          p_expense_id: 'expense-1',
          p_merchant_id: 'merchant-1',
          p_storage_path: 'expenses/merchant-1/receipt.pdf',
        },
      },
    ]);
    assert.match(messages[0], /removed=1/);
  });

  it('fails closed when worker database credentials are missing', async () => {
    const mock = createSupabaseMock();

    await assert.rejects(
      cleanupLegacyExpenseReceipts({
        createSupabaseClient: mock.createSupabaseClient,
        env: {},
      }),
      /NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/
    );
    assert.equal(mock.calls.length, 0);
  });

  it('reports claim failures to the scheduler', async () => {
    const mock = createSupabaseMock({
      claimError: { message: 'claim unavailable' },
    });

    await assert.rejects(
      cleanupLegacyExpenseReceipts({
        createSupabaseClient: mock.createSupabaseClient,
        env: requiredEnv,
      }),
      /claim unavailable/
    );
  });
});
