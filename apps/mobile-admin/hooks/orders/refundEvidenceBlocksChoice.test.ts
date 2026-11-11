import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));

import { refundEvidenceBlocksChoice } from './refundEvidenceBlocksChoice';

describe('refundEvidenceBlocksChoice', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not block when no evidence is open', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    await expect(refundEvidenceBlocksChoice('o1')).resolves.toBe(false);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'order_has_unresolved_refund_evidence',
      { p_order_id: 'o1' }
    );
  });

  it.each([
    ['evidence is open', { data: true, error: null }],
    ['the check errors', { data: null, error: { message: 'x' } }],
  ])('blocks when %s', async (_name, result) => {
    mocks.rpc.mockResolvedValue(result);
    await expect(refundEvidenceBlocksChoice('o1')).resolves.toBe(true);
  });

  it('blocks when the call throws', async () => {
    mocks.rpc.mockRejectedValue(new Error('offline'));
    await expect(refundEvidenceBlocksChoice('o1')).resolves.toBe(true);
  });
});
