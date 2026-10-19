import { describe, expect, it, vi } from 'vitest';

const { mockCreateQuizRpcServerProof } = vi.hoisted(() => ({
  mockCreateQuizRpcServerProof: vi.fn(),
}));

vi.mock('@/lib/quiz-proof', () => ({
  createQuizRpcServerProof: mockCreateQuizRpcServerProof,
}));

import { createRedvaultDiscountProof } from './create-redvault-discount-proof';

describe('createRedvaultDiscountProof', () => {
  it('signs only the frozen REDVAULT action and version', () => {
    mockCreateQuizRpcServerProof.mockReturnValue({ proof_id: 'proof-1' });

    const result = createRedvaultDiscountProof({
      customerEmail: 'buyer@example.com',
      groups: [],
      merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      orderId: '00000000-0000-0000-0000-000000000001',
      quotePayloadHash: 'a'.repeat(64),
      quoteVersionId: '00000000-0000-0000-0000-000000000002',
      totals: {
        discountKobo: 500_000,
        eligibleSubtotalKobo: 10_000_000,
        productSubtotalKobo: 15_000_000,
      },
      userId: 'guest',
    });

    expect(result.nonce).toEqual(expect.any(String));
    expect(mockCreateQuizRpcServerProof).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'storefront_redvault_discount',
        subjectId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
        userId: 'guest',
        payload: expect.objectContaining({
          version: 1,
          partnership: 'uba_redvault',
          orderId: '00000000-0000-0000-0000-000000000001',
          quoteVersionId: '00000000-0000-0000-0000-000000000002',
          quotePayloadHash: 'a'.repeat(64),
          taxBasis: 'exclusive',
        }),
      })
    );
  });
});
