import { afterEach, describe, expect, it, vi } from 'vitest';
import { readUploadBytes } from './readUploadBytes';

describe('readUploadBytes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns bytes from a readable local URI', async () => {
    const bytes = new ArrayBuffer(3);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        arrayBuffer: vi.fn().mockResolvedValue(bytes),
        ok: true,
      })
    );

    await expect(readUploadBytes('file:///picked.jpg')).resolves.toBe(bytes);
  });

  it('rejects when the local URI cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    await expect(readUploadBytes('file:///missing.jpg')).rejects.toThrow(
      'Unable to read the selected file. Please choose it again.'
    );
  });
});
