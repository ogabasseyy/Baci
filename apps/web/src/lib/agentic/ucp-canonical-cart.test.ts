import { expect, it, vi } from 'vitest';
import { LegacyBridgeError } from '@/lib/cart/legacy-canonical-bridge';
import { handleCanonicalUcpCart } from './ucp-canonical-cart';

vi.mock('server-only', () => ({}));
const input = {
  merchant: { id: 'merchant', slug: 'shop' },
  cartId: 'legacy',
  agentId: 'agent',
  action: 'read' as const,
};
function fixture() {
  const state = {
    cartId: 'canonical',
    merchantId: 'merchant',
    state: 'active',
    version: 3,
    currency: 'USD',
    expiresAt: '2099-01-01',
    checkoutSessionId: null,
    replayed: false,
    lines: [],
  };
  const open = vi.fn().mockResolvedValue({ state });
  const operate = vi.fn().mockResolvedValue({
    ok: true,
    state,
    continueUrl: 'https://shop/cart#handoff=secret',
    proof: 'never-expose-proof',
  });
  return {
    readOperationId: vi
      .fn()
      .mockReturnValueOnce('read-one')
      .mockReturnValue('read-two'),
    enabled: vi.fn().mockResolvedValue(true),
    open,
    operate,
  };
}
it('opens canonical authority for the verified caller and returns a recoverable continuation', async () => {
  const deps = fixture();
  const result = await handleCanonicalUcpCart(input, deps as never);
  expect(deps.open).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: 'ucp',
      handle: 'legacy',
      agentId: 'agent',
    })
  );
  expect(result).toMatchObject({
    status: 200,
    body: {
      id: 'legacy',
      cart_id: 'legacy',
      canonical_cart_id: 'canonical',
      cart_version: 3,
      currency: 'USD',
      continue_url: 'https://shop/cart#handoff=secret',
    },
  });
  expect(result?.body).not.toHaveProperty('proof');
});
it('delegates replacements with the signed operation id and canonical expected version', async () => {
  const deps = fixture();
  await handleCanonicalUcpCart(
    {
      ...input,
      action: 'update',
      lines: [{ item: { productId: 'p' }, quantity: 2 }],
      operationId: 'signed-op',
      expectedVersion: 2,
    },
    deps as never
  );
  expect(deps.operate).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      command: {
        type: 'replace',
        lines: [{ item: { productId: 'p' }, quantity: 2 }],
      },
      expectedVersion: 2,
      operationId: expect.stringMatching(/^ucp-update:/),
    })
  );
});
it('creates with the full lane identity and issues a continuation', async () => {
  const deps = fixture();
  const lines = [
    {
      item: {
        productId: 'p',
        variantId: 'v',
        condition: 'used' as const,
        options: { storage: '128GB' },
      },
      quantity: 2,
    },
  ];
  const result = await handleCanonicalUcpCart(
    { ...input, action: 'create', lines, operationId: 'create-op' },
    deps as never
  );
  expect(deps.operate).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      command: { type: 'replace', lines },
      handoff: true,
      operationId: expect.stringMatching(/^ucp-create:/),
    })
  );
  expect(result).toMatchObject({
    status: 200,
    body: { continue_url: 'https://shop/cart#handoff=secret' },
  });
});
it('projects the full canonical line identity for read-modify-replace', async () => {
  const deps = fixture();
  const line = {
    id: 'line-1',
    productId: 'p',
    variantId: 'v',
    condition: 'used',
    options: { storage: '128GB' },
    quantity: 1,
    unitPriceMinor: 500,
    available: true,
  };
  const state = {
    cartId: 'canonical',
    merchantId: 'merchant',
    state: 'active',
    version: 3,
    currency: 'USD',
    expiresAt: '2099-01-01',
    checkoutSessionId: null,
    replayed: false,
    lines: [line],
  };
  deps.open.mockResolvedValue({ state });
  deps.operate.mockResolvedValue({
    ok: true,
    state,
    continueUrl: 'https://shop/cart#handoff=secret',
  });
  const result = await handleCanonicalUcpCart(input, deps as never);
  expect(result?.body.line_items).toEqual([
    expect.objectContaining({
      item: expect.objectContaining({
        product_id: 'p',
        variant_id: 'v',
        variant_attributes: { storage: '128GB' },
        condition: 'used',
      }),
    }),
  ]);
});
it('never falls back to legacy data after enrolled authority fails', async () => {
  const deps = fixture();
  deps.open.mockRejectedValue(new Error('private database detail'));
  expect(await handleCanonicalUcpCart(input, deps as never)).toEqual({
    status: 503,
    body: { code: 'temporarily_unavailable', error: 'Shared cart unavailable' },
  });
});
it('skips migration for unenrolled merchants and refuses unverified callers', async () => {
  const deps = fixture();
  deps.enabled.mockResolvedValue(false);
  expect(await handleCanonicalUcpCart(input, deps as never)).toBeNull();
  expect(deps.open).not.toHaveBeenCalled();
  deps.enabled.mockResolvedValue(true);
  expect(
    await handleCanonicalUcpCart({ ...input, agentId: null }, deps as never)
  ).toMatchObject({ status: 404 });
  expect(deps.open).not.toHaveBeenCalled();
});
it('requires a canonical handoff for checkout and clears contents for cancellation', async () => {
  const deps = fixture();
  expect(
    await handleCanonicalUcpCart(
      { ...input, action: 'checkout', operationId: 'checkout' },
      deps as never
    )
  ).toMatchObject({
    status: 409,
    body: {
      code: 'checkout_requires_handoff',
      continue_url: expect.any(String),
    },
  });
  await handleCanonicalUcpCart(
    { ...input, action: 'cancel', operationId: 'cancel', expectedVersion: 3 },
    deps as never
  );
  expect(deps.operate).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ command: { type: 'clear' }, expectedVersion: 3 })
  );
});

it('fences unversioned UCP update and cancel mutations after the cart has been migrated or shared', async () => {
  const deps = fixture();
  const updateResult = await handleCanonicalUcpCart(
    {
      ...input,
      action: 'update',
      lines: [{ item: { productId: 'p' }, quantity: 2 }],
      operationId: 'late-update',
    },
    deps as never
  );
  expect(updateResult).toMatchObject({
    status: 409,
    body: {
      code: 'refresh_required',
      cart_version: 3,
      continue_url: 'https://shop/cart#handoff=secret',
    },
  });
  expect(deps.operate.mock.calls[0][1]).not.toHaveProperty('command');

  const cancelResult = await handleCanonicalUcpCart(
    { ...input, action: 'cancel', operationId: 'late-cancel' },
    deps as never
  );
  expect(cancelResult).toMatchObject({
    status: 409,
    body: {
      code: 'refresh_required',
      cart_version: 3,
      continue_url: 'https://shop/cart#handoff=secret',
    },
  });
  expect(deps.operate.mock.calls[1][1]).not.toHaveProperty('command');
});

it('hides canonical carts when the broker rejects a different agent', async () => {
  const deps = fixture();
  deps.open.mockRejectedValue(new LegacyBridgeError('unauthorized'));
  expect(await handleCanonicalUcpCart(input, deps as never)).toEqual({
    status: 404,
    body: { error: 'Cart not found' },
  });
  expect(deps.operate).not.toHaveBeenCalled();
});

it('returns a continuation instead of silently dropping unsupported buyer or delivery changes', async () => {
  const deps = fixture();
  const result = await handleCanonicalUcpCart(
    {
      ...input,
      action: 'update',
      detailsRequireHandoff: true,
      lines: [{ item: { productId: 'p' }, quantity: 2 }],
    },
    deps as never
  );
  expect(result).toMatchObject({
    status: 409,
    body: {
      code: 'cart_details_require_handoff',
      continue_url: expect.any(String),
    },
  });
  expect(deps.operate.mock.calls[0][1]).not.toHaveProperty('command');
});
it('rejects malformed canonical versions before resolving authority', async () => {
  const deps = fixture();
  expect(
    await handleCanonicalUcpCart(
      { ...input, action: 'update', expectedVersion: '3' },
      deps as never
    )
  ).toMatchObject({ status: 400 });
  expect(deps.open).not.toHaveBeenCalled();
});
it('does not mint a handoff credential for a plain read', async () => {
  const deps = fixture();
  await handleCanonicalUcpCart(input, deps as never);
  expect(deps.operate).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ handoff: false })
  );
  await handleCanonicalUcpCart({ ...input, action: 'update' }, deps as never);
  expect(deps.operate).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ handoff: true })
  );
});

it('keeps signed mutation operation keys stable and refreshes read handoff attempt identity', async () => {
  const deps = fixture();
  await handleCanonicalUcpCart(
    { ...input, action: 'cancel', operationId: 'same', expectedVersion: 3 },
    deps as never
  );
  const first = deps.operate.mock.calls[0][1].operationId;
  await handleCanonicalUcpCart(
    { ...input, action: 'cancel', operationId: 'same', expectedVersion: 3 },
    deps as never
  );
  expect(deps.operate.mock.calls[1][1].operationId).toBe(first);
  await handleCanonicalUcpCart(input, deps as never);
  await handleCanonicalUcpCart(input, deps as never);
  expect(deps.operate.mock.calls[2][1].operationId).not.toBe(
    deps.operate.mock.calls[3][1].operationId
  );
});

it('retains the owner recovery handle in cart_id for the next read', async () => {
  const deps = fixture();
  const first = await handleCanonicalUcpCart(input, deps as never);
  await handleCanonicalUcpCart(
    { ...input, cartId: String(first?.body.cart_id) },
    deps as never
  );
  expect(deps.open).toHaveBeenLastCalledWith(
    expect.objectContaining({ handle: 'legacy' })
  );
});
it('derives replay-safe mutation keys when the request omits an operation id', async () => {
  const deps = fixture();
  await handleCanonicalUcpCart(
    { ...input, action: 'cancel', expectedVersion: 3 },
    deps as never
  );
  await handleCanonicalUcpCart(
    { ...input, action: 'cancel', expectedVersion: 3 },
    deps as never
  );
  expect(deps.operate.mock.calls[0][1].operationId).toBe(
    deps.operate.mock.calls[1][1].operationId
  );
});

it('returns expired canonical ownership as not found without leaking authority details', async () => {
  const deps = fixture();
  deps.open.mockRejectedValue(new LegacyBridgeError('expired'));
  expect(await handleCanonicalUcpCart(input, deps as never)).toEqual({
    status: 404,
    body: { error: 'Cart not found' },
  });
});
