import { beforeEach, expect, it, vi } from 'vitest';
import { ucpCartMigrationRaceOutcome } from './ucp-cart-migration-race';
import { loadUcpCartSession } from './ucp-cart-session-read';

vi.mock('./ucp-cart-session-read', () => ({ loadUcpCartSession: vi.fn() }));
vi.mock('./ucp-cart-route-support', () => {
  throw new Error('Race recovery must not import route bootstrap authority');
});
const args = {
  cartId: 'legacy',
  merchantId: 'merchant',
  agentId: 'agent',
  supabase: {} as never,
  error: { code: 'P0001', message: 'migrated cart is read-only' },
};
beforeEach(() => vi.clearAllMocks());
it('does not reload ordinary database errors', async () => {
  expect(
    await ucpCartMigrationRaceOutcome({ ...args, error: new Error('outage') })
  ).toBeNull();
  expect(loadUcpCartSession).not.toHaveBeenCalled();
});
it('reloads the merchant and caller scoped canonical identity', async () => {
  vi.mocked(loadUcpCartSession).mockResolvedValue({
    cart: { agent_id: 'agent', migratedToCartId: 'canonical' } as never,
    error: null,
  });
  expect(await ucpCartMigrationRaceOutcome(args)).toMatchObject({
    status: 409,
    body: { cart_id: 'canonical', code: 'refresh_required' },
  });
  expect(loadUcpCartSession).toHaveBeenCalledWith({
    cartId: 'legacy',
    merchantId: 'merchant',
    supabase: args.supabase,
  });
});
it.each([
  { cart: null, error: new Error('reload failed') },
  { cart: { agent_id: 'other', migratedToCartId: 'private' }, error: null },
])('keeps refresh retryable without leaking unavailable or foreign successor data', async (result) => {
  vi.mocked(loadUcpCartSession).mockResolvedValue(result as never);
  expect(await ucpCartMigrationRaceOutcome(args)).toMatchObject({
    status: 409,
    body: { cart_id: null, code: 'refresh_required' },
  });
});

it('still returns refresh when transport throws while reloading the committed mapping', async () => {
  vi.mocked(loadUcpCartSession).mockRejectedValueOnce(new Error('network'));
  expect(await ucpCartMigrationRaceOutcome(args)).toMatchObject({
    status: 409,
    body: { cart_id: null, code: 'refresh_required' },
  });
});
