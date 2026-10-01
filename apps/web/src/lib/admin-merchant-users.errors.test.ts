import { describe, expect, it, vi } from 'vitest';
import { getAdminMerchantUserDirectory } from '@/lib/admin-merchant-users';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';

describe('getAdminMerchantUserDirectory compatibility export', () => {
  it('rejects an invalid merchant ID before calling the RPC', async () => {
    const rpc = vi.fn();

    const result = await getAdminMerchantUserDirectory(
      { rpc } as never,
      'not-a-uuid'
    );

    expect(result).toEqual({
      data: null,
      error: { code: 'INVALID_MERCHANT_ID', message: 'Invalid merchant ID' },
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns a bounded-RPC error without attempting tenant-table reads', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'platform_admin_required' },
    });

    const result = await getAdminMerchantUserDirectory(
      { rpc } as never,
      MERCHANT_ID
    );

    expect(result.error).toMatchObject({ code: '42501' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
