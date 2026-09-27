import { describe, expect, it, vi } from 'vitest';
import { purgeOrphanedJumiaAuthorization } from './purge-orphaned-jumia-authorization';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

describe('purgeOrphanedJumiaAuthorization', () => {
  it('invokes the authenticated purge RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'purged', error: null });

    await expect(
      purgeOrphanedJumiaAuthorization(
        { rpc } as never,
        'merchant-1',
        'integration-1'
      )
    ).resolves.toBe('purged');

    expect(rpc).toHaveBeenCalledWith('purge_orphaned_jumia_authorization', {
      p_merchant_id: 'merchant-1',
      p_integration_id: 'integration-1',
    });
  });

  it('reports a reactivated integration so the route answers 409', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'reactivated', error: null });

    await expect(
      purgeOrphanedJumiaAuthorization(
        { rpc } as never,
        'merchant-1',
        'integration-1'
      )
    ).resolves.toBe('reactivated');
  });

  it('reports a deferred cleanup when the RPC fails', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'database unavailable' },
    });

    await expect(
      purgeOrphanedJumiaAuthorization(
        { rpc } as never,
        'merchant-1',
        'integration-1'
      )
    ).resolves.toBe('failed');
  });

  it('reports a deferred cleanup on an unexpected RPC status', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'bogus', error: null });

    await expect(
      purgeOrphanedJumiaAuthorization(
        { rpc } as never,
        'merchant-1',
        'integration-1'
      )
    ).resolves.toBe('failed');
  });
});
