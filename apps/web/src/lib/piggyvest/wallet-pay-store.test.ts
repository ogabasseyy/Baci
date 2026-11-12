import { describe, expect, it, vi } from 'vitest';
import {
  WALLET_PAY_CUSTOMER_STATEMENTS as customerSql,
  WALLET_PAY_WORKER_STATEMENTS as workerSql,
} from './wallet-pay-statements';
import {
  createWalletPayCustomerStore,
  createWalletPayWorkerStore,
} from './wallet-pay-store';

vi.mock('server-only', () => ({}));

const OP = '5b0f2a40-1c1d-4e6b-9a51-2f3c4d5e6f70';
const INTEGRATION = '8e3a5c62-4f4f-4a8e-9d73-5b6c7d8e9fa1';
const scope = {
  merchantId: '1a2b3c4d-0000-4000-8000-000000000001',
  customerId: '1a2b3c4d-0000-4000-8000-000000000002',
  userId: '1a2b3c4d-0000-4000-8000-000000000003',
  integrationId: INTEGRATION,
  businessId: 'business-1',
  environment: 'staging' as const,
};
const rows = (result: unknown) => ({ rows: [{ result }] });

describe('createWalletPayCustomerStore', () => {
  it('issues with the server-priced request under the customer scope', async () => {
    const execute = vi.fn(async () =>
      rows({
        status: 'issued',
        operationId: OP,
        amountKobo: 100000,
        expiresAt: 'x',
      })
    );
    const store = createWalletPayCustomerStore({ scope, execute });
    await expect(
      store.issue({
        purpose: 'imei_check',
        purchaseRef: 'lookup-1',
        amountKobo: 100000,
      })
    ).resolves.toMatchObject({ status: 'issued', operationId: OP });
    expect(execute).toHaveBeenCalledWith(customerSql.issue, [
      JSON.stringify(scope),
      JSON.stringify({
        purpose: 'imei_check',
        purchaseRef: 'lookup-1',
        amountKobo: 100000,
      }),
    ]);
  });

  it('refuses a client-shaped issue request before any SQL', async () => {
    const execute = vi.fn();
    const store = createWalletPayCustomerStore({ scope, execute });
    await expect(
      store.issue({ purpose: 'checkout', purchaseRef: 'x', amountKobo: 1 })
    ).rejects.toThrow();
    await expect(
      store.issue({ purpose: 'vtu', purchaseRef: 'x', amountKobo: 1, extra: 1 })
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it('reserves with the PIN proof and parses every answer', async () => {
    const execute = vi.fn(async () =>
      rows({ status: 'pin_refused', reason: 'mismatch' })
    );
    const store = createWalletPayCustomerStore({ scope, execute });
    await expect(store.reserve(OP, 'a'.repeat(64))).resolves.toEqual({
      status: 'pin_refused',
      reason: 'mismatch',
    });
    expect(execute).toHaveBeenCalledWith(customerSql.reserve, [
      JSON.stringify(scope),
      JSON.stringify({ operationId: OP }),
      'a'.repeat(64),
    ]);
  });

  it('sends an empty proof as the missing proof (the database refuses it)', async () => {
    const execute = vi.fn(async () =>
      rows({ status: 'pin_refused', reason: 'missing' })
    );
    const store = createWalletPayCustomerStore({ scope, execute });
    await store.reserve(OP, '');
    expect(execute.mock.calls[0][1][2]).toBe('');
  });

  it('throws on an unexpected database answer', async () => {
    const execute = vi.fn(async () => rows({ status: 'claimed' }));
    const store = createWalletPayCustomerStore({ scope, execute });
    await expect(store.reserve(OP, '')).rejects.toThrow();
  });

  it('manages transitions with a fixed action list', async () => {
    const execute = vi.fn(async () => rows(true));
    const store = createWalletPayCustomerStore({ scope, execute });
    await expect(store.manage(OP, 'dispatch')).resolves.toBe(true);
    expect(execute).toHaveBeenCalledWith(customerSql.manage, [
      JSON.stringify(scope),
      OP,
      'dispatch',
    ]);
  });
});

describe('createWalletPayWorkerStore', () => {
  it('binds every call to the configured integration and environment', async () => {
    const execute = vi.fn(async () =>
      rows({
        status: 'claimed',
        purpose: 'vtu',
        purchaseRef: 'vtu-1',
        amountKobo: 5000,
      })
    );
    const store = createWalletPayWorkerStore({
      integrationId: INTEGRATION,
      environment: 'staging',
      execute,
    });
    await expect(store.claim(OP)).resolves.toMatchObject({ status: 'claimed' });
    expect(execute).toHaveBeenCalledWith(workerSql.claim, [
      INTEGRATION,
      'staging',
      OP,
    ]);
  });

  it('finishes with only fulfilled or failed', async () => {
    const execute = vi.fn(async () => rows('refund_owed'));
    const store = createWalletPayWorkerStore({
      integrationId: INTEGRATION,
      environment: 'staging',
      execute,
    });
    await expect(store.finish(OP, 'failed')).resolves.toBe('refund_owed');
    await expect(store.finish(OP, 'refunded' as 'failed')).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
