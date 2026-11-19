import { describe, expect, it, vi } from 'vitest';
import { primarySavingsProvisioningSchemas as schemas } from '@/schemas/primary-savings-provisioning';
import { provisionPrimarySavingsWallet } from './primary-savings-provisioning';
import {
  fixture,
  goalId,
  walletName,
} from './primary-savings-provisioning.input.test-support';

vi.mock('server-only', () => ({}));

async function status(setupRetryable: boolean | undefined, wallets: unknown[]) {
  const input = fixture();
  input.mode = 'recover';
  input.store.read.mockResolvedValue({
    ...(await input.store.read()),
    ...(setupRetryable === undefined ? {} : { setupRetryable }),
  });
  input.listWallets.mockResolvedValue(wallets);
  return { input, result: await provisionPrimarySavingsWallet(input) };
}

describe('setup retry flag on a stalled status read', () => {
  it('flags a pending read whose stored claim has expired as retryable', async () => {
    const { input, result } = await status(true, []);
    expect(result).toMatchObject({ status: 'pending', setupRetryable: true });
    expect(input.createWallet).not.toHaveBeenCalled();
  });

  it.each([
    false,
    undefined,
  ])('never flags a live claim (flag %s) as retryable', async (flag) => {
    const { result } = await status(flag, []);
    expect(result.status).toBe('pending');
    expect(result.setupRetryable).not.toBe(true);
  });

  it('does not flag a ready wallet even when the claim looked expired', async () => {
    const { result } = await status(true, [
      { id: 'destination', name: walletName, status: 'active' },
    ]);
    expect(result.status).toBe('ready');
    expect(result.setupRetryable).not.toBe(true);
  });

  it('never flags a provisioning pending that follows a fresh create failure', async () => {
    const input = fixture();
    input.listWallets.mockResolvedValue([]);
    input.createWallet.mockRejectedValue(new Error('provider down'));
    const result = await provisionPrimarySavingsWallet(input);
    expect(result.status).toBe('pending');
    expect(result.setupRetryable).not.toBe(true);
  });
});

describe('setup retry flag in the response contract', () => {
  const base = {
    goalId,
    interestAccepted: true,
    interestEnrollment: 'requested' as const,
    accounts: [],
  };
  it('accepts it on pending and rejects it on any other status', () => {
    expect(
      schemas.response.safeParse({
        ...base,
        status: 'pending',
        setupRetryable: true,
      }).success
    ).toBe(true);
    expect(
      schemas.response.safeParse({
        ...base,
        status: 'unavailable',
        setupRetryable: true,
      }).success
    ).toBe(false);
  });
});
