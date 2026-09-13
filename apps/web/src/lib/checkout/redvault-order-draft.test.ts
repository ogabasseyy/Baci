import { describe, expect, it, vi } from 'vitest';
import { createRedvaultOrderDraft } from './redvault-order-draft';

const draft = {
  id: '00000000-0000-0000-0000-000000000001',
  proof_context: { groups: [] },
  quote_payload_hash: 'a'.repeat(64),
  quote_version_id: '00000000-0000-0000-0000-000000000002',
  status: 'pending',
};
const summary = {
  order_id: draft.id,
  total: 95,
  currency: 'NGN',
  tracking_token: 'track',
  payment_method: 'uba_redvault',
  payment_status: 'unpaid',
  product_subtotal_kobo: 10000,
  eligible_subtotal_kobo: 10000,
  ineligible_subtotal_kobo: 0,
  discount_kobo: 500,
  assurance_fee_kobo: 0,
  tax_kobo: 0,
  shipping_kobo: 0,
  gift_wrapping_kobo: 0,
  payable_kobo: 9500,
  mixed_basket: false,
};

describe('createRedvaultOrderDraft', () => {
  it('creates and attaches in one mutation before reading the summary', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: [draft], error: null })
      .mockResolvedValueOnce({ data: [summary], error: null });
    const draftArgs = { p_order: {}, p_quote: {}, p_route_proof: {} };
    const result = await createRedvaultOrderDraft({
      client: { rpc } as never,
      draftArgs,
    });
    expect(result.id).toBe(draft.id);
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      'create_storefront_redvault_order',
      draftArgs
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      'get_storefront_redvault_checkout_summary',
      { p_order_id: draft.id }
    );
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      data: null,
      error: { message: 'attachment failed' },
      message: 'attachment failed',
    },
    {
      data: [{ ...draft, quote_version_id: null }],
      error: null,
      message: 'Unable to create REDVAULT order draft',
    },
    {
      data: [{ ...draft, status: 'draft' }],
      error: null,
      message: 'redvault_attachment_not_pending',
    },
  ])('never reads a summary after incomplete atomic creation: $message', async ({
    data,
    error,
    message,
  }) => {
    const rpc = vi.fn().mockResolvedValue({ data, error });
    await expect(
      createRedvaultOrderDraft({ client: { rpc } as never, draftArgs: {} })
    ).rejects.toThrow(message);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('does not retry an indeterminate creation failure', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('response lost'));
    await expect(
      createRedvaultOrderDraft({ client: { rpc } as never, draftArgs: {} })
    ).rejects.toThrow('response lost');
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('surfaces summary failure without another creation mutation', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: [draft], error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'summary failed' },
      });
    await expect(
      createRedvaultOrderDraft({ client: { rpc } as never, draftArgs: {} })
    ).rejects.toThrow('summary failed');
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
