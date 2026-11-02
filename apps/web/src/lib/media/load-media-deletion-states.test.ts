import { describe, expect, it, vi } from 'vitest';
import { loadMediaDeletionStates } from './load-media-deletion-states';

describe('media deletion status loading', () => {
  it('loads more than 100 files in bounded batches and fails closed on a later error', async () => {
    const files = Array.from({ length: 101 }, (_, i) => ({
      name: `${i}.webp`,
    }));
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          { path: 'merchant/0.webp', state: 'pending' },
          { path: 'merchant/1.webp', state: 'deleted' },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ path: 'merchant/100.webp', state: 'pending' }],
        error: null,
      });
    const result = await loadMediaDeletionStates({ rpc }, 'merchant', files);
    expect(rpc.mock.calls.map((call) => call[1].p_paths.length)).toEqual([
      100, 1,
    ]);
    expect(result?.find((file) => file.name === '0.webp')?.deletionState).toBe(
      'pending'
    );
    expect(result?.some((file) => file.name === '1.webp')).toBe(false);
    expect(
      result?.find((file) => file.name === '100.webp')?.deletionState
    ).toBe('pending');
    rpc
      .mockReset()
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: null, error: {} });
    expect(
      await loadMediaDeletionStates({ rpc }, 'merchant', files)
    ).toBeNull();
  });
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
