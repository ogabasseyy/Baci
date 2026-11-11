import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));

import { readPersistedCancellationRefundMode } from './read-persisted-cancellation-refund-mode';

function supabaseReturning(result: { data: unknown; error: unknown }) {
  const eq2 = vi.fn(() => ({
    maybeSingle: vi.fn().mockResolvedValue(result),
  }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  return {
    from: vi.fn(() => ({ select: vi.fn(() => ({ eq: eq1 })) })),
  } as never;
}

const args = { merchantId: 'm1', orderId: 'o1' };

describe('readPersistedCancellationRefundMode', () => {
  it('returns the persisted manual mode', async () => {
    const supabase = supabaseReturning({
      data: { cancellation_refund_mode: 'manual' },
      error: null,
    });
    await expect(
      readPersistedCancellationRefundMode({
        ...args,
        supabase,
      })
    ).resolves.toBe('manual');
  });

  it('treats a legacy null as automatic', async () => {
    const supabase = supabaseReturning({
      data: { cancellation_refund_mode: null },
      error: null,
    });
    await expect(
      readPersistedCancellationRefundMode({ ...args, supabase })
    ).resolves.toBe('automatic');
  });

  it('returns null instead of guessing when the read fails', async () => {
    const supabase = supabaseReturning({
      data: null,
      error: { message: 'down' },
    });
    await expect(
      readPersistedCancellationRefundMode({ ...args, supabase })
    ).resolves.toBeNull();
  });
});
