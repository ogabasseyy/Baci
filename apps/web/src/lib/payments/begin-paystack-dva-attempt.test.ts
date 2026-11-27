import { beforeEach, expect, it, vi } from 'vitest';
import { beginPaystackDvaAttempt } from './begin-paystack-dva-attempt';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  sign: vi.fn(),
  log: vi.fn(),
}));

vi.mock('@/lib/supabase/scoped', () => ({
  createScopedClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock('@/lib/supabase/scoped-jwt', () => ({
  signScopedSupabaseJwt: mocks.sign,
}));
vi.mock('@/lib/logger', () => ({ logger: { error: mocks.log } }));

const input = {
  amountKobo: 1250000,
  customerEmail: ' Ada@Example.Test ',
  merchantId: 'merchant',
  orderId: 'order',
  reference: 'BAC-123456789012',
  trackingToken: 'tracking-proof',
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.sign.mockReturnValue('scoped-jwt');
});

it.each([
  { kind: 'claimed' },
  { kind: 'legacy' },
  { kind: 'pending' },
  { kind: 'refused' },
  {
    kind: 'saved',
    reference: input.reference,
    dva: {
      account_name: 'Test Store',
      account_number: '1234567890',
      bank_name: 'Test Bank',
    },
  },
])('preserves the $kind receipt and binds the claim to the order', async (data) => {
  mocks.rpc.mockResolvedValue({ data, error: null });
  expect(await beginPaystackDvaAttempt(input)).toEqual(data);
  expect(mocks.rpc).toHaveBeenCalledWith('begin_chat_paystack_dva_attempt', {
    p_tracking_token: input.trackingToken,
  });
  expect(mocks.sign).toHaveBeenCalledWith({
    aud: 'authenticated',
    role: 'authenticated',
    iat: expect.any(Number),
    exp: expect.any(Number),
    paystack_dva_attempt: {
      amount_kobo: input.amountKobo,
      customer_email: 'ada@example.test',
      merchant_id: input.merchantId,
      order_id: input.orderId,
      reference: input.reference,
    },
  });
  const { iat, exp } = mocks.sign.mock.calls[0][0];
  expect(exp - iat).toBe(60);
});

it.each([
  { data: { kind: 'pending' }, error: new Error('private upstream details') },
  { data: { kind: 'saved' }, error: null },
])('fails closed when the receipt cannot be trusted', async (rpcResult) => {
  mocks.rpc.mockResolvedValue(rpcResult);
  expect(await beginPaystackDvaAttempt(input)).toEqual({ kind: 'unavailable' });
  expect(mocks.log).toHaveBeenCalledOnce();
  expect(JSON.stringify(mocks.log.mock.calls)).not.toContain(
    'private upstream details'
  );
});

it('treats a transport exception as unavailable', async () => {
  mocks.rpc.mockRejectedValue(new Error('network'));
  expect(await beginPaystackDvaAttempt(input)).toEqual({ kind: 'unavailable' });
});
