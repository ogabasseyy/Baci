import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./legacy-scoped-client', () => ({
  createLegacyOwnerScopedClient: vi.fn(),
}));
vi.mock('./scoped-client', () => ({ createCartScopedClient: vi.fn() }));
vi.mock('./cart-runtime-env', () => ({
  getCartProofEnvironment: () => 'test',
}));
vi.mock('./handoff', () => ({ issueCartHandoff: vi.fn() }));
vi.mock('./session-proof', () => ({ issueCartSessionProof: vi.fn() }));

import {
  openLegacyCanonicalCart,
  operateLegacyCanonicalCart,
} from './legacy-canonical-bridge';

const merchant = { id: '11111111-1111-4111-8111-111111111111', slug: 'shop' };
const cartId = '22222222-2222-4222-8222-222222222222';
const productId = '33333333-3333-4333-8333-333333333333';
const grantId = '44444444-4444-4444-8444-444444444444';
const state = {
  cartId,
  merchantId: merchant.id,
  state: 'active' as const,
  version: 3,
  lines: [{ id: 'line', productId, variantId: null, quantity: 1 }],
  expiresAt: '2099-01-01T00:00:00Z',
  currency: 'NGN',
};
const recovered = {
  ok: true,
  cartId,
  grantId,
  grantExpiresAt: '2099-01-01T00:00:00Z',
  allowedOperations: ['add', 'set_quantity', 'remove', 'clear'],
};
function setup() {
  const rpc = vi.fn().mockResolvedValue({ data: recovered, error: null });
  const deps = {
    assertConfig: vi.fn(),
    ownerClient: vi.fn().mockReturnValue({ rpc }),
    sessionClient: vi.fn().mockReturnValue({}),
    migrate: vi.fn().mockResolvedValue({ ok: true }),
    read: vi
      .fn()
      .mockResolvedValue({ ok: true, state: { ...state, version: 4 } }),
    mutate: vi
      .fn()
      .mockResolvedValue({ ok: true, state: { ...state, version: 4 } }),
    proof: vi.fn().mockReturnValue('cp1.valid.signature'),
    handoff: vi.fn().mockResolvedValue({
      ok: true,
      continueUrl: 'https://shop.example/cart#handoff=token',
    }),
  };
  return { rpc, deps };
}
beforeEach(() => vi.clearAllMocks());
it('verifies persisted owner before migrating exact stored lines and reloading durable authority', async () => {
  const { rpc, deps } = setup();
  const lines = [{ item: { productId }, quantity: 1 }];
  rpc.mockResolvedValueOnce({
    data: { ok: true, lines, legacyVersion: '7', currency: 'NGN' },
    error: null,
  });
  const cart = await openLegacyCanonicalCart(
    { provider: 'mcp', handle: 'a'.repeat(64), merchant },
    deps as never
  );
  expect(deps.migrate).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ lines, legacyVersion: '7', provider: 'mcp' })
  );
  expect(cart.principal).toMatchObject({ cartId, grantId, scope: 'session' });
  expect(deps.read).toHaveBeenCalledWith(expect.anything(), cartId);
});
it('recovers stable principal authority on a new process without remigrating', async () => {
  const a = setup();
  const b = setup();
  const owner = {
    provider: 'ucp' as const,
    handle: 'cart-owned',
    agentId: 'agent',
    merchant,
  };
  const first = await openLegacyCanonicalCart(owner, a.deps as never);
  const second = await openLegacyCanonicalCart(owner, b.deps as never);
  expect(first.principal.principalId).toBe(second.principal.principalId);
  expect(b.deps.migrate).not.toHaveBeenCalled();
});
it('fails closed on owner mismatch and missing proof configuration before writing', async () => {
  const { rpc, deps } = setup();
  rpc.mockResolvedValue({
    data: { ok: false, code: 'unauthorized' },
    error: null,
  });
  await expect(
    openLegacyCanonicalCart(
      { provider: 'mcp', handle: 'a'.repeat(64), merchant },
      deps as never
    )
  ).rejects.toMatchObject({ code: 'unauthorized' });
  expect(deps.migrate).not.toHaveBeenCalled();
  deps.assertConfig.mockImplementation(() => {
    throw new Error('missing secret');
  });
  await expect(
    openLegacyCanonicalCart(
      { provider: 'mcp', handle: 'a'.repeat(64), merchant },
      deps as never
    )
  ).rejects.toThrow('missing secret');
  expect(deps.migrate).not.toHaveBeenCalled();
});
it('uses per-line absolute quantity with caller version/key and issues canonical checkout handoff', async () => {
  const { deps } = setup();
  const cart = await openLegacyCanonicalCart(
    { provider: 'mcp', handle: 'a'.repeat(64), merchant },
    deps as never
  );
  const result = await operateLegacyCanonicalCart(cart, {
    edit: { productId, quantity: 2 },
    expectedVersion: 3,
    operationId: 'op',
    handoff: true,
  });
  expect(deps.mutate).toHaveBeenCalledWith(expect.anything(), {
    cartId,
    command: { type: 'set_quantity', lineId: 'line', quantity: 2 },
    expectedVersion: 3,
    operationId: 'op',
  });
  expect(result).toMatchObject({
    ok: true,
    continueUrl: 'https://shop.example/cart#handoff=token',
  });
});
it('keeps version conflicts definitive without preparing a handoff', async () => {
  const { deps } = setup();
  deps.mutate.mockResolvedValue({
    ok: false,
    code: 'version_conflict',
    state,
  } as never);
  const cart = await openLegacyCanonicalCart(
    { provider: 'mcp', handle: 'a'.repeat(64), merchant },
    deps as never
  );
  expect(
    await operateLegacyCanonicalCart(cart, {
      edit: { productId, quantity: 2 },
      expectedVersion: 2,
      handoff: true,
    })
  ).toMatchObject({ ok: false, code: 'version_conflict' });
  expect(deps.handoff).not.toHaveBeenCalled();
});

it('refuses product-only changes that could select voucher or condition siblings', async () => {
  const { deps } = setup();
  deps.read.mockResolvedValue({
    ok: true,
    state: {
      ...state,
      lines: [
        ...state.lines,
        { ...state.lines[0], id: 'voucher', voucherToken: 'prize' },
      ],
    },
  } as never);
  const cart = await openLegacyCanonicalCart(
    { provider: 'mcp', handle: 'a'.repeat(64), merchant },
    deps as never
  );
  await expect(
    operateLegacyCanonicalCart(cart, { edit: { productId, quantity: 0 } })
  ).rejects.toMatchObject({ code: 'refresh_required' });
  expect(deps.mutate).not.toHaveBeenCalled();
});

it('reads authoritative revision four after replaying a revision two mutation receipt', async () => {
  const { deps } = setup();
  const current = { ...state, version: 4 };
  deps.read.mockResolvedValue({ ok: true, state: current });
  deps.mutate.mockResolvedValue({
    ok: true,
    state: { ...state, version: 2 },
    replayed: true,
    currentVersion: 4,
  } as never);
  const cart = await openLegacyCanonicalCart(
    { provider: 'mcp', handle: 'a'.repeat(64), merchant },
    deps as never
  );
  const result = await operateLegacyCanonicalCart(cart, {
    edit: { productId, quantity: 2 },
    expectedVersion: 1,
    operationId: 'old-receipt',
    handoff: true,
  });
  expect(result.state?.version).toBe(4);
  expect(deps.read).toHaveBeenCalledTimes(2);
});
