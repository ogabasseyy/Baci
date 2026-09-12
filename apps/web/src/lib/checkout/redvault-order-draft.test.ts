import { describe, expect, it, vi } from 'vitest';

import { createRedvaultOrderDraft } from './redvault-order-draft';

const draft = {
  id: '00000000-0000-0000-0000-000000000001',
  proof_context: { groups: [] },
  quote_payload_hash: 'a'.repeat(64),
  quote_version_id: '00000000-0000-0000-0000-000000000002',
};
const draftArgs = {
  p_merchant_id: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
};
const createProof = vi.fn(() => ({ proof_id: 'proof-1' }));

function input(rpc: ReturnType<typeof vi.fn>) {
  return {
    client: { rpc } as never,
    createProof,
    draftArgs,
  };
}

describe('createRedvaultOrderDraft', () => {
  it('creates a draft first and attaches its proof only to that returned order and quote', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            id: '00000000-0000-0000-0000-000000000001',
            proof_context: { groups: [] },
            quote_payload_hash: 'a'.repeat(64),
            quote_version_id: '00000000-0000-0000-0000-000000000002',
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: [{ status: 'pending' }], error: null })
      .mockResolvedValueOnce({
        data: [
          {
            order_id: '00000000-0000-0000-0000-000000000001',
            total: 95,
            currency: 'NGN',
            tracking_token: 'track-1',
            payment_method: 'uba_redvault',
            payment_status: 'unpaid',
            product_subtotal_kobo: 10000,
            eligible_subtotal_kobo: 10000,
            ineligible_subtotal_kobo: 0,
            discount_kobo: 500,
            tax_kobo: 0,
            shipping_kobo: 0,
            gift_wrapping_kobo: 0,
            payable_kobo: 9500,
            mixed_basket: false,
          },
        ],
        error: null,
      });
    const client = { rpc };

    const result = await createRedvaultOrderDraft({
      client: client as never,
      createProof: (draft) => ({ proof_id: 'proof-1', order_id: draft.id }),
      draftArgs: { p_merchant_id: '6b5cb8a4-5575-456c-b936-8cdfae30db74' },
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: '00000000-0000-0000-0000-000000000001',
        quotePayloadHash: 'a'.repeat(64),
        quoteVersionId: '00000000-0000-0000-0000-000000000002',
      })
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      'attach_storefront_redvault_discount_proof',
      expect.objectContaining({
        p_order_id: '00000000-0000-0000-0000-000000000001',
        p_quote_payload_hash: 'a'.repeat(64),
        p_quote_version_id: '00000000-0000-0000-0000-000000000002',
      })
    );
    expect(rpc).toHaveBeenNthCalledWith(
      3,
      'get_storefront_redvault_checkout_summary',
      {
        p_order_id: '00000000-0000-0000-0000-000000000001',
      }
    );
  });

  it('stops before proof attachment when draft creation fails', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'draft RPC failed' },
    });

    await expect(createRedvaultOrderDraft(input(rpc))).rejects.toThrow(
      'draft RPC failed'
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(createProof).not.toHaveBeenCalled();
  });

  it('stops before proof attachment when the draft row is malformed', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ ...draft, quote_version_id: null }],
      error: null,
    });

    await expect(createRedvaultOrderDraft(input(rpc))).rejects.toThrow(
      'Unable to create REDVAULT order draft'
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(createProof).not.toHaveBeenCalled();
  });

  it('stops before summary lookup when proof attachment fails', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: [draft], error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'proof attachment failed' },
      });

    await expect(createRedvaultOrderDraft(input(rpc))).rejects.toThrow(
      'proof attachment failed'
    );

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenLastCalledWith(
      'attach_storefront_redvault_discount_proof',
      expect.any(Object)
    );
  });

  it('stops before summary lookup when proof attachment is not pending', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: [draft], error: null })
      .mockResolvedValueOnce({ data: [{ status: 'approved' }], error: null });

    await expect(createRedvaultOrderDraft(input(rpc))).rejects.toThrow(
      'redvault_attachment_not_pending'
    );

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenLastCalledWith(
      'attach_storefront_redvault_discount_proof',
      expect.any(Object)
    );
  });

  it('does not make further calls when checkout summary lookup fails', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: [draft], error: null })
      .mockResolvedValueOnce({ data: [{ status: 'pending' }], error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'summary failed' },
      });

    await expect(createRedvaultOrderDraft(input(rpc))).rejects.toThrow(
      'summary failed'
    );

    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc).toHaveBeenLastCalledWith(
      'get_storefront_redvault_checkout_summary',
      { p_order_id: draft.id }
    );
  });
});
