import { describe, expect, it, vi } from 'vitest';

import { purgeExpiredJumiaSelfAuthorizationDiscoveries } from './purge-expired-jumia-self-authorization-discoveries';

describe('purgeExpiredJumiaSelfAuthorizationDiscoveries', () => {
  it('returns the number of purged discoveries from the worker RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 3, error: null });

    await expect(
      purgeExpiredJumiaSelfAuthorizationDiscoveries({ rpc } as never)
    ).resolves.toBe(3);
    expect(rpc).toHaveBeenCalledWith(
      'purge_expired_jumia_self_authorization_discoveries'
    );
  });

  it('fails with a safe error when the worker RPC fails', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'rpc failed' },
    });

    await expect(
      purgeExpiredJumiaSelfAuthorizationDiscoveries({ rpc } as never)
    ).rejects.toThrow(
      'Failed to purge expired Jumia self-authorization discoveries: rpc failed'
    );
  });
});
