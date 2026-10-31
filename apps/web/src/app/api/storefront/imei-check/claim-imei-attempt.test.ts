import { expect, it, vi } from 'vitest';
import type { ImeiAccessClient } from '@/lib/imei-access';
import { claimImeiAttempt } from './claim-imei-attempt';

const context = {
  customerId: 'customer',
  merchantId: 'merchant',
  tier: 'blacklist' as const,
  imeiHash: 'a'.repeat(64),
};
const requestedKey = '11111111-1111-4111-8111-111111111111';

it('fails closed if a claim cannot be obtained', async () => {
  const access = {
    claimAttempt: vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'unavailable' } }),
  } as unknown as ImeiAccessClient;
  const result = await claimImeiAttempt({
    access,
    context,
    requestedKey,
    supportsRepeat: true,
  });
  expect(result.response?.status).toBe(503);
});

it('requires an explicit fresh check when another key has a completed report', async () => {
  const canonical = '22222222-2222-4222-8222-222222222222';
  const access = {
    claimAttempt: vi
      .fn()
      .mockResolvedValue({ data: { idempotency_key: canonical }, error: null }),
    readReplay: vi.fn().mockResolvedValue({
      data: { id: 'lookup', status: 'completed' },
      error: null,
    }),
  } as unknown as ImeiAccessClient;
  const result = await claimImeiAttempt({
    access,
    context,
    requestedKey,
    supportsRepeat: true,
  });
  expect(result.response?.status).toBe(409);
  expect(await result.response?.json()).toMatchObject({
    code: 'PREVIOUS_REPORT_AVAILABLE',
    lookupId: 'lookup',
  });
});
