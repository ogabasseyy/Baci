import { describe, expect, it, vi } from 'vitest';
import { readPrimaryWalletMapping } from './primary-wallet-mapping';

vi.mock('server-only', () => ({}));
const scope = {
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  customerId: 'e648eb14-928a-427b-9719-b105f6d4b8b4',
  userId: 'f4f01e61-691f-494a-a895-872f17f8e55e',
  integrationId: 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
  businessId: 'business-test',
  environment: 'production' as const,
};
describe('primary wallet mapping read', () => {
  it('reads only the validated server scope through a bounded function', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [
        {
          result: {
            providerWalletId: 'wallet-test',
            providerCustomerId: 'customer-test',
          },
        },
      ],
    });
    expect(await readPrimaryWalletMapping(scope, execute)).toEqual({
      providerWalletId: 'wallet-test',
      providerCustomerId: 'customer-test',
    });
    expect(execute).toHaveBeenCalledWith(
      'SELECT piggyvest_primary.read_onboarding($1::jsonb) AS result',
      [JSON.stringify(scope)]
    );
  });
  it('does not treat absent rows as a confirmed absent wallet', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    await expect(readPrimaryWalletMapping(scope, execute)).rejects.toThrow(
      'Primary wallet mapping unavailable'
    );
  });
});
