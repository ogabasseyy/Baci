import { describe, expect, it, vi } from 'vitest';
import { selectGiglWorkerCredential } from './gigl-worker-rotation';

describe('GIGL worker credential selection', () => {
  it('uses the primary when its non-mutating probe succeeds', async () => {
    const probe = vi.fn().mockResolvedValue('valid');
    await expect(
      selectGiglWorkerCredential('primary', 'secondary', probe)
    ).resolves.toBe('primary');
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith('primary');
  });

  it('uses the secondary only after an explicit primary authentication rejection', async () => {
    const probe = vi
      .fn()
      .mockResolvedValueOnce('auth-rejected')
      .mockResolvedValueOnce('valid');
    await expect(
      selectGiglWorkerCredential('primary', 'secondary', probe)
    ).resolves.toBe('secondary');
    expect(probe.mock.calls).toEqual([['primary'], ['secondary']]);
  });

  it('fails closed on an indeterminate probe without trying another credential', async () => {
    const probe = vi.fn().mockResolvedValue('indeterminate');
    await expect(
      selectGiglWorkerCredential('primary', 'secondary', probe)
    ).rejects.toThrow();
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('fails closed if neither credential authenticates', async () => {
    const probe = vi.fn().mockResolvedValue('auth-rejected');
    await expect(
      selectGiglWorkerCredential('primary', 'secondary', probe)
    ).rejects.toThrow();
    expect(probe).toHaveBeenCalledTimes(2);
  });
});
