import { describe, expect, it, vi } from 'vitest';
import { checkRateLimit } from './rate-limiter';

describe('checkRateLimit', () => {
  it('propagates verification quota RPC errors to the unavailable-response mapper', async () => {
    const unavailable = new Error('database unavailable');
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: unavailable,
      }),
    };

    await expect(
      checkRateLimit(supabase, 'user-1', 'verify-nin', 3, 1)
    ).rejects.toBe(unavailable);
  });

  it('propagates verification quota RPC exceptions to the unavailable-response mapper', async () => {
    const unavailable = new Error('database unavailable');
    const supabase = {
      rpc: vi.fn().mockRejectedValue(unavailable),
    };

    await expect(
      checkRateLimit(supabase, 'user-1', 'verify-nin', 3, 1)
    ).rejects.toBe(unavailable);
  });

  it('retains a denied verification quota as a fail-closed result', async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
    };

    await expect(
      checkRateLimit(supabase, 'user-1', 'verify-nin', 3, 1)
    ).resolves.toBe(false);
  });

  it('allows a verification quota check when the RPC returns true', async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    };

    await expect(
      checkRateLimit(supabase, 'user-1', 'verify-nin', 3, 1)
    ).resolves.toBe(true);
  });

  it('fails closed when a verification quota RPC returns no result', async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    };

    await expect(
      checkRateLimit(supabase, 'user-1', 'verify-nin', 3, 1)
    ).rejects.toThrow('Rate limit RPC returned no result');
  });

  it('preserves fail-open handling for non-verification quota checks', async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: new Error('database unavailable'),
      }),
    };

    await expect(
      checkRateLimit(supabase, 'user-1', 'newsletter', 3, 1)
    ).resolves.toBe(true);
  });

  it('preserves fail-open handling when a non-verification quota RPC rejects', async () => {
    const supabase = {
      rpc: vi.fn().mockRejectedValue(new Error('database unavailable')),
    };

    await expect(
      checkRateLimit(supabase, 'user-1', 'newsletter', 3, 1)
    ).resolves.toBe(true);
  });

  it('preserves fail-open handling when a non-verification quota RPC returns no result', async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    };

    await expect(
      checkRateLimit(supabase, 'user-1', 'newsletter', 3, 1)
    ).resolves.toBe(true);
  });

  it('fails closed for non-verification endpoints that opt in', async () => {
    const unavailable = new Error('database unavailable');
    const errored = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: unavailable }),
    };
    const rejected = {
      rpc: vi.fn().mockRejectedValue(unavailable),
    };

    await expect(
      checkRateLimit(errored, 'm1', 'search_assist_tenant', 60, 1, {
        failClosed: true,
      })
    ).rejects.toBe(unavailable);
    await expect(
      checkRateLimit(rejected, 'm1', 'search_assist_tenant', 60, 1, {
        failClosed: true,
      })
    ).rejects.toBe(unavailable);
  });
});
