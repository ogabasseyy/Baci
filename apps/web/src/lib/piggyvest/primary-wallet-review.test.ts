import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readPrimaryWalletReview } from './primary-wallet-review';
import { PRIMARY_WALLET_STATEMENTS } from './primary-wallet-statements';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

vi.mock('server-only', () => ({}));

const scope = {
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  customerId: 'e648eb14-928a-427b-9719-b105f6d4b8b4',
  userId: 'f4f01e61-691f-494a-a895-872f17f8e55e',
  integrationId: 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
  businessId: 'test-business',
  environment: 'staging' as const,
};

describe('readPrimaryWalletReview', () => {
  let execute: ReturnType<typeof vi.fn<PiggyvestProvisioningExecutor>>;

  beforeEach(() => {
    execute = vi
      .fn<PiggyvestProvisioningExecutor>()
      .mockResolvedValue({ rows: [{ result: 'routing' }] });
  });

  it('binds the validated full scope and returns only the review reason', async () => {
    const result = await readPrimaryWalletReview({ scope, execute });

    expect(execute).toHaveBeenCalledExactlyOnceWith(
      PRIMARY_WALLET_STATEMENTS.readReview,
      [JSON.stringify(scope)]
    );
    expect(result).toBe('routing');
    expect(JSON.stringify(result)).not.toMatch(
      /provider(Customer|Wallet)Id|customer-fixture|wallet-fixture/
    );
  });

  it.each([
    ['missing result row', { rows: [] }],
    [
      'multiple result rows',
      { rows: [{ result: null }, { result: 'routing' }] },
    ],
    [
      'provider identifiers instead of a reason',
      {
        rows: [
          {
            result: {
              review_reason: 'routing',
              providerCustomerId: 'customer-fixture',
              providerWalletId: 'wallet-fixture',
            },
          },
        ],
      },
    ],
  ])('fails closed on a malformed SQL result: %s', async (_label, response) => {
    execute.mockResolvedValue(response);

    await expect(readPrimaryWalletReview({ scope, execute })).rejects.toThrow(
      'Primary wallet review unavailable'
    );
    expect(execute).toHaveBeenCalledOnce();
  });

  it('rejects an invalid foreign scope before executing SQL', async () => {
    await expect(
      readPrimaryWalletReview({
        scope: { ...scope, customerId: 'foreign-customer' },
        execute,
      })
    ).rejects.toThrow('Primary wallet review unavailable');
    expect(execute).not.toHaveBeenCalled();
  });
});
