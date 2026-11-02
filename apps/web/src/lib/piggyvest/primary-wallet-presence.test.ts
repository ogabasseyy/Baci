import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hasPrimaryWalletOnboarding } from './primary-wallet-presence';
import { PRIMARY_WALLET_STATEMENTS } from './primary-wallet-statements';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

vi.mock('server-only', () => ({}));

const scope = {
  merchantId: '10000000-0000-4000-8000-000000000001',
  customerId: '10000000-0000-4000-8000-000000000002',
  userId: '10000000-0000-4000-8000-000000000003',
  integrationId: '10000000-0000-4000-8000-000000000004',
  businessId: 'business-test',
  environment: 'staging' as const,
};

describe('hasPrimaryWalletOnboarding', () => {
  let execute: ReturnType<typeof vi.fn<PiggyvestProvisioningExecutor>>;

  beforeEach(() => {
    execute = vi
      .fn<PiggyvestProvisioningExecutor>()
      .mockResolvedValue({ rows: [{ result: false }] });
  });

  it.each([
    true,
    false,
  ])('returns the authoritative presence %s for the full validated scope', async (result) => {
    execute.mockResolvedValue({ rows: [{ result }] });

    expect(await hasPrimaryWalletOnboarding(scope, execute)).toBe(result);
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      PRIMARY_WALLET_STATEMENTS.presence,
      [JSON.stringify(scope)]
    );
  });

  it.each([
    ['an extra key', { ...scope, providerWalletId: 'client-wallet' }],
    ['a missing customer', { ...scope, customerId: undefined }],
    ['a non-uuid user', { ...scope, userId: 'not-a-uuid' }],
    ['an unknown environment', { ...scope, environment: 'sandbox' }],
  ])('rejects %s before any database call', async (_label, invalid) => {
    await expect(
      hasPrimaryWalletOnboarding(invalid as unknown as typeof scope, execute)
    ).rejects.toThrow('Primary wallet onboarding presence unavailable');
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ['no result row', { rows: [] }],
    ['two result rows', { rows: [{ result: false }, { result: true }] }],
    ['a null result', { rows: [{ result: null }] }],
    ['a string result', { rows: [{ result: 'false' }] }],
    ['an extra column', { rows: [{ result: false, intent_id: 'leak' }] }],
  ])('fails closed on %s instead of reporting not started', async (_label, response) => {
    execute.mockResolvedValue(response);

    await expect(hasPrimaryWalletOnboarding(scope, execute)).rejects.toThrow(
      'Primary wallet onboarding presence unavailable'
    );
  });

  it('hides the database error detail when the lookup fails', async () => {
    execute.mockRejectedValue(new Error('private database detail'));

    const failure = await hasPrimaryWalletOnboarding(scope, execute).catch(
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      'Primary wallet onboarding presence unavailable'
    );
  });
});
