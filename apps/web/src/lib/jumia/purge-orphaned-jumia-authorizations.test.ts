import { describe, expect, it } from 'vitest';
import { purgeOrphanedJumiaAuthorizations } from './purge-orphaned-jumia-authorizations';

describe('purgeOrphanedJumiaAuthorizations', () => {
  it('returns the number of credentials removed by the sweep', async () => {
    const rpc = async (name: string) => {
      expect(name).toBe('purge_orphaned_jumia_authorizations');
      return { data: 2, error: null };
    };

    await expect(
      purgeOrphanedJumiaAuthorizations({ rpc } as never)
    ).resolves.toBe(2);
  });

  it('surfaces a failed sweep so the cron invocation is retried', async () => {
    const rpc = async () => ({
      data: null,
      error: { message: 'temporary database failure' },
    });

    await expect(
      purgeOrphanedJumiaAuthorizations({ rpc } as never)
    ).rejects.toThrow('temporary database failure');
  });
});
