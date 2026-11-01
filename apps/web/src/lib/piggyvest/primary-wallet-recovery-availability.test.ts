import { describe, expect, it, vi } from 'vitest';
import { canRecoverPrimaryWalletOnboarding } from './primary-wallet-recovery-availability';

vi.mock('server-only', () => ({}));
const scope = {
  merchantId: '10000000-0000-4000-8000-000000000001',
  customerId: '10000000-0000-4000-8000-000000000002',
  userId: '10000000-0000-4000-8000-000000000003',
  integrationId: '10000000-0000-4000-8000-000000000004',
  businessId: 'business-test',
  environment: 'staging',
};
describe('primary wallet recovery availability', () => {
  it.each([
    true,
    false,
  ])('returns authoritative recovery eligibility %s', async (result) => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ result }] });
    expect(await canRecoverPrimaryWalletOnboarding(scope, execute)).toBe(
      result
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('can_recover_onboarding'),
      [JSON.stringify(scope)]
    );
  });
  it('does not turn malformed or unavailable state into permission to retry creation', async () => {
    await expect(
      canRecoverPrimaryWalletOnboarding(
        scope,
        vi.fn().mockResolvedValue({ rows: [] })
      )
    ).rejects.toThrow();
    await expect(
      canRecoverPrimaryWalletOnboarding(
        scope,
        vi.fn().mockRejectedValue(new Error('unavailable'))
      )
    ).rejects.toThrow();
  });
});
