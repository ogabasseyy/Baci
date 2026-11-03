import { describe, expect, it, vi } from 'vitest';
import { createBoundRedvaultDraft } from './redvault-shared-cart-binding';

const sharedCart = {
  principalId: 'verified-principal',
  binding: {
    cart_id: 'cart-1',
    cart_version: 3,
    checkout_generation: 2,
    checkout_session_id: 'session-1',
  },
};
const orderArgs = { p_merchant_id: 'merchant-1', p_items: [] };
const draftArgs = {
  p_order: { merchant_id: 'merchant-1' },
  p_quote: { payableKobo: 10250 },
  p_route_proof: { signature: 'fixture' },
};
const order = {
  id: 'order-1',
  quote_version_id: 'quote-1',
  quote_payload_hash: 'hash',
  status: 'pending',
  proof_context: {},
  idempotency_replayed: false,
};
const receipt = {
  ok: true,
  replayed: false,
  order,
  binding: {
    variant: 'redvault',
    sessionId: 'session-1',
    cartId: 'cart-1',
    merchantId: 'merchant-1',
    checkout_generation: 2,
    cartVersionReviewed: 3,
  },
};

describe('createBoundRedvaultDraft', () => {
  it('sends the verified cart binding and signed draft to the scoped RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: receipt, error: null });
    const result = await createBoundRedvaultDraft({
      client: { rpc } as never,
      sharedCart,
      orderArgs,
      draftArgs,
    });

    expect(result).toEqual(order);
    expect(rpc).toHaveBeenCalledWith(
      'create_storefront_order_with_cart_binding',
      {
        p_variant: 'redvault',
        p_session_id: 'session-1',
        p_generation: 2,
        p_args: {
          ...orderArgs,
          p_cart_id: 'cart-1',
          p_cart_version: 3,
          p_cart_principal_id: 'verified-principal',
          p_redvault_order: draftArgs.p_order,
          p_redvault_quote: draftArgs.p_quote,
          p_redvault_route_proof: draftArgs.p_route_proof,
        },
      }
    );
  });

  it('rejects an absent principal before any RPC', async () => {
    const rpc = vi.fn();
    await expect(
      createBoundRedvaultDraft({
        client: { rpc } as never,
        sharedCart: { ...sharedCart, principalId: null },
        orderArgs,
        draftArgs,
      })
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    { binding: { ...receipt.binding, sessionId: 'other-session' } },
    { binding: { ...receipt.binding, merchantId: 'other-merchant' } },
    { binding: { ...receipt.binding, variant: 'base' } },
    { replayed: true },
    { order: { ...order, quote_version_id: null } },
  ])('fails closed for a receipt that does not match the reviewed cart', async (change) => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { ...receipt, ...change }, error: null });
    await expect(
      createBoundRedvaultDraft({
        client: { rpc } as never,
        sharedCart,
        orderArgs,
        draftArgs,
      })
    ).rejects.toMatchObject({ code: 'temporarily_unavailable' });
  });

  it.each([
    ['cart_checkout_stale', 'refresh_required'],
    ['cart_checkout_expired', 'expired'],
    ['cart_order_unauthorized', 'unauthorized'],
  ])('maps %s to a safe cart error', async (message, code) => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'P0001', message },
    });
    await expect(
      createBoundRedvaultDraft({
        client: { rpc } as never,
        sharedCart,
        orderArgs,
        draftArgs,
      })
    ).rejects.toMatchObject({ code });
  });

  it('records only a redacted diagnostic for an unexpected database error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { code: '42501', message: 'private fixture data' },
      });
      await expect(
        createBoundRedvaultDraft({
          client: { rpc } as never,
          sharedCart,
          orderArgs,
          draftArgs,
        })
      ).rejects.toMatchObject({ code: 'temporarily_unavailable' });
      expect(log).toHaveBeenCalledWith('REDVAULT cart binding unavailable', {
        stage: 'rpc_error',
        code: '42501',
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain(
        'private fixture data'
      );
      expect(JSON.stringify(log.mock.calls)).not.toContain('fixture');
    } finally {
      log.mockRestore();
    }
  });
});
