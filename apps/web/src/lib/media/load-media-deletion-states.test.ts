import { describe, expect, it, vi } from 'vitest';
import { loadMediaDeletionStates } from './load-media-deletion-states';

describe('media deletion status loading', () => {
  it('identifies pending files and keeps active files selectable', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ path: 'merchant/pending.webp', state: 'pending' }],
      error: null,
    });
    expect(
      await loadMediaDeletionStates({ rpc }, 'merchant', [
        { name: 'pending.webp' },
        { name: 'active.webp' },
      ])
    ).toEqual([
      { name: 'pending.webp', deletionState: 'pending' },
      { name: 'active.webp', deletionState: 'active' },
    ]);
  });
  it('fails closed for unavailable or malformed status', async () => {
    expect(
      await loadMediaDeletionStates(
        { rpc: vi.fn().mockResolvedValue({ data: null, error: {} }) },
        'merchant',
        [{ name: 'image' }]
      )
    ).toBeNull();
  });
  it('omits deleted files still present in a stale storage listing', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ path: 'merchant/deleted.webp', state: 'deleted' }],
      error: null,
    });
    expect(
      await loadMediaDeletionStates({ rpc }, 'merchant', [
        { name: 'deleted.webp' },
        { name: 'active.webp' },
      ])
    ).toEqual([{ name: 'active.webp', deletionState: 'active' }]);
  });
});
