import { describe, expect, it, vi } from 'vitest';
import { resetTransportDispatchForFallback } from './zeptomail-dispatch-reset';

describe('resetTransportDispatchForFallback', () => {
  it('resolves true when the reset lands', async () => {
    const reset = vi.fn().mockResolvedValue(undefined);
    await expect(resetTransportDispatchForFallback(reset)).resolves.toBe(true);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('resolves true when no reset hook is configured', async () => {
    await expect(resetTransportDispatchForFallback(undefined)).resolves.toBe(
      true
    );
  });

  it('resolves false when the reset fails transiently', async () => {
    const reset = vi.fn().mockRejectedValue(new Error('supabase unavailable'));
    await expect(resetTransportDispatchForFallback(reset)).resolves.toBe(false);
  });
});
