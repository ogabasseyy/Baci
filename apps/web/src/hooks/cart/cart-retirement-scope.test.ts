import { expect, it, vi } from 'vitest';
import { fetchWithCsrf } from '@/lib/api-client';
import {
  resetPendingCartDeviceRevocationsForTests,
  revokeCartDeviceSession,
} from './shared-cart-session-revoke-client';

vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));

import {
  beginCartSessionRetirement,
  isCartSessionRetirementReady,
} from './cart-session-write-fence';

it('does not reuse another merchant retirement for an unnamed revocation', async () => {
  const retirement = beginCartSessionRetirement('shop');
  try {
    await retirement.drained;
    expect(isCartSessionRetirementReady('shop')).toBe(true);
    expect(isCartSessionRetirementReady(undefined)).toBe(false);
    expect(isCartSessionRetirementReady('other-shop')).toBe(false);
  } finally {
    retirement.release();
  }
});

it('does not send an unnamed revoke using a different merchant retirement', async () => {
  const retirement = beginCartSessionRetirement('shop');
  try {
    await retirement.drained;
    await expect(revokeCartDeviceSession(undefined)).resolves.toEqual({
      ok: false,
    });
    expect(fetchWithCsrf).not.toHaveBeenCalled();
  } finally {
    retirement.release();
    resetPendingCartDeviceRevocationsForTests();
  }
});
