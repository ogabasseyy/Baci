import { describe, expect, it, vi } from 'vitest';
import { generateSupabaseReplayTypes } from './generate-supabase-replay-types';

describe('generateSupabaseReplayTypes', () => {
  it('generates public types and returns the unmodified command result', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: 'generated', stderr: '' });
    expect(
      await generateSupabaseReplayTypes(run, 'postgresql://private')
    ).toEqual({ stdout: 'generated', stderr: '' });
    expect(run).toHaveBeenCalledWith('supabase', [
      'gen',
      'types',
      'typescript',
      '--db-url',
      'postgresql://private',
      '--schema',
      'public',
    ]);
  });
  it('labels failures without exposing database URL or raw provider errors', async () => {
    const run = vi
      .fn()
      .mockRejectedValue(new Error('postgresql://private token=secret'));
    await expect(
      generateSupabaseReplayTypes(run, 'postgresql://private')
    ).rejects.toThrow(/^Supabase replay stage gen types failed$/);
  });
});
