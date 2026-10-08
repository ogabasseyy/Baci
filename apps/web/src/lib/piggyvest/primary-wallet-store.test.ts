import { describe, expect, it, vi } from 'vitest';
import { createPrimaryWalletStore } from './primary-wallet-store';

vi.mock('server-only', () => ({}));

const scope = {
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  customerId: 'e648eb14-928a-427b-9719-b105f6d4b8b4',
  userId: 'f4f01e61-691f-494a-a895-872f17f8e55e',
  integrationId: 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
  businessId: 'test-business',
  environment: 'production' as const,
};
const intentId = '00000000-0000-4000-8000-000000000001';
const claimToken = '00000000-0000-4000-8000-000000000002';

describe('primary wallet storage boundary', () => {
  it('rejects substituted authenticated ownership without querying', async () => {
    const execute = vi.fn();
    const store = createPrimaryWalletStore({ scope, execute });
    await expect(
      store.claim({
        ...scope,
        userId: intentId,
        requestFingerprint: 'a'.repeat(64),
      })
    ).rejects.toThrow('Primary wallet storage unavailable');
    expect(execute).not.toHaveBeenCalled();
  });

  it('uses a parameterized atomic claim and parses its durable result', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [{ result: { status: 'claimed', intentId, claimToken } }],
    });
    const store = createPrimaryWalletStore({ scope, execute });
    await expect(
      store.claim({ ...scope, requestFingerprint: 'a'.repeat(64) })
    ).resolves.toEqual({ status: 'claimed', intentId, claimToken });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('piggyvest_primary.claim_onboarding'),
      [JSON.stringify(scope), 'a'.repeat(64)]
    );
  });

  it('rejects malformed database claims rather than contacting the provider', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [{ result: { status: 'claimed', intentId } }],
    });
    await expect(
      createPrimaryWalletStore({ scope, execute }).claim({
        ...scope,
        requestFingerprint: 'a'.repeat(64),
      })
    ).rejects.toThrow('Primary wallet storage unavailable');
  });

  it('requires database confirmation that accepted identifiers were stored', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ result: false }] });
    await expect(
      createPrimaryWalletStore({ scope, execute }).recordAccepted({
        ...scope,
        intentId,
        claimToken,
        providerCustomerId: 'provider-customer',
        providerWalletId: 'provider-wallet',
      })
    ).resolves.toBe(false);
  });

  it('fails safely when an uncertain state cannot be durably recorded', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ result: false }] });
    await expect(
      createPrimaryWalletStore({ scope, execute }).recordUncertain({
        ...scope,
        intentId,
        claimToken,
      })
    ).rejects.toThrow('Primary wallet storage unavailable');
  });

  it('never exposes database diagnostic text', async () => {
    const execute = vi
      .fn()
      .mockRejectedValue(new Error('secret connection detail'));
    await expect(
      createPrimaryWalletStore({ scope, execute }).claim({
        ...scope,
        requestFingerprint: 'a'.repeat(64),
      })
    ).rejects.toThrow('Primary wallet storage unavailable');
  });
});
