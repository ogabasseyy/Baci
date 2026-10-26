import { describe, expect, it, vi } from 'vitest';
import { hasPrimaryWalletOnboarding } from './primary-wallet-presence';

vi.mock('server-only', () => ({}));
const scope = {
  merchantId: '10000000-0000-4000-8000-000000000001',
  customerId: '10000000-0000-4000-8000-000000000002',
  userId: '10000000-0000-4000-8000-000000000003',
  integrationId: '10000000-0000-4000-8000-000000000004',
  businessId: 'business-test',
  environment: 'staging',
};
describe('primary wallet onboarding presence', () => {
  it.each([
    true,
    false,
  ])('returns authoritative presence %s', async (result) => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ result }] });
    expect(await hasPrimaryWalletOnboarding(scope, execute)).toBe(result);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('has_onboarding'),
      [JSON.stringify(scope)]
    );
  });
  it('does not turn malformed or unavailable state into permission to retry creation', async () => {
    await expect(
      hasPrimaryWalletOnboarding(scope, vi.fn().mockResolvedValue({ rows: [] }))
    ).rejects.toThrow();
    await expect(
      hasPrimaryWalletOnboarding(
        scope,
        vi.fn().mockRejectedValue(new Error('unavailable'))
      )
    ).rejects.toThrow();
  });
});
