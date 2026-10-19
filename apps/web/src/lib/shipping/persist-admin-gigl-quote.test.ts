import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({
  getSupabaseServiceRoleKey: () => 's'.repeat(32),
}));

import { persistAdminGiglQuote } from './persist-admin-gigl-quote';

describe('persistAdminGiglQuote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists through the caller-bound authenticated Admin GIGL RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'quote-1', error: null });
    const quote = { id: 'quote-1', provider: 'GIGL' };
    const attestation = { quote_id: 'quote-1', order_id: 'order-1' };

    await expect(
      persistAdminGiglQuote({
        supabase: { rpc } as never,
        quote,
        attestation,
      })
    ).resolves.toMatchObject({ data: 'quote-1', error: null });

    expect(rpc).toHaveBeenCalledWith('persist_authenticated_admin_gigl_quote', {
      p_quote: quote,
      p_attestation: attestation,
      p_route_proof: expect.objectContaining({
        action: 'persist_authenticated_admin_gigl_quote',
        subject_id: 'order-1',
      }),
    });
  });

  it('returns the trusted writer error without reshaping it', async () => {
    const error = { message: 'invalid_admin_quote' };
    const rpc = vi.fn().mockResolvedValue({ data: null, error });

    await expect(
      persistAdminGiglQuote({
        supabase: { rpc } as never,
        quote: {},
        attestation: {},
      })
    ).resolves.toEqual({ data: null, error });
  });
});
