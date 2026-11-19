import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDvaPostLogoutFinalizerClient,
  hasDvaPostLogoutFinalizationEvidence,
} from './dva-postlogout-finalizer-client';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(() => ({ rpc: vi.fn() })),
  getAnonKey: vi.fn(() => 'anon-key'),
  getUrl: vi.fn(() => 'https://supabase.example.com'),
}));

vi.mock('server-only', () => ({}));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
vi.mock('@/env', () => ({
  getSupabaseAnonKey: mocks.getAnonKey,
  getSupabaseUrl: mocks.getUrl,
}));

const validScope = {
  accountNumber: '1234567890',
  agenticSessionId: 'agentic_session_abc123',
  binding: {
    cart_id: '00000000-0000-4000-8000-000000000002',
    cart_version: 7,
    checkout_generation: 3,
    checkout_session_id: '00000000-0000-4000-8000-000000000003',
  },
  finalizationClaim: 'agentic_order_abc123',
  merchantId: '00000000-0000-4000-8000-000000000001',
};

describe('createDvaPostLogoutFinalizerClient', () => {
  beforeEach(() => mocks.createClient.mockClear());

  it('mints a short-lived dedicated-role token scoped to server binding and DVA state', () => {
    const signer = { secret: 'test-secret', type: 'legacy-secret' as const };
    createDvaPostLogoutFinalizerClient(validScope, {
      now: new Date('2026-11-07T12:00:00.000Z'),
      signer,
    });

    const [, , options] = mocks.createClient.mock.calls[0] as unknown as [
      string,
      string,
      { global: { headers: { Authorization: string } }; auth: unknown },
    ];
    const token = options.global.headers.Authorization.replace('Bearer ', '');
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')
    );
    expect(payload).toMatchObject({
      aud: 'authenticated',
      role: 'agentic_dva_finalizer',
      agentic_context: 'checkout',
      agentic_merchant_id: validScope.merchantId,
      iat: 1794052800,
      exp: 1794052860,
      agentic_dva_post_logout: {
        version: '1',
        merchant_id: validScope.merchantId,
        agentic_session_id: validScope.agenticSessionId,
        checkout_session_id: validScope.binding.checkout_session_id,
        cart_id: validScope.binding.cart_id,
        cart_version: 7,
        checkout_generation: 3,
        account_number: '1234567890',
        finalization_claim: 'agentic_order_abc123',
      },
    });
    expect(options.auth).toEqual({
      autoRefreshToken: false,
      persistSession: false,
    });
  });

  it.each([
    ['merchant', { ...validScope, merchantId: 'bad' }],
    ['agenticSessionId', { ...validScope, agenticSessionId: '' }],
    [
      'session',
      {
        ...validScope,
        binding: { ...validScope.binding, checkout_session_id: 'bad' },
      },
    ],
    ['account', { ...validScope, accountNumber: '123' }],
    ['claim', { ...validScope, finalizationClaim: '' }],
  ])('rejects malformed %s authority before creating a client', (_name, scope) => {
    expect(() =>
      createDvaPostLogoutFinalizerClient(scope as typeof validScope, {
        signer: { secret: 'test-secret', type: 'legacy-secret' },
      })
    ).toThrow();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

describe('hasDvaPostLogoutFinalizationEvidence', () => {
  type ProbeSupabase = Parameters<
    typeof hasDvaPostLogoutFinalizationEvidence
  >[0]['supabase'];

  it('returns true only when the evidence RPC confirms recovery availability', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    await expect(
      hasDvaPostLogoutFinalizationEvidence({
        ...validScope,
        supabase: { rpc } as unknown as ProbeSupabase,
      })
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'commerce_cart_agentic_dva_recovery_available',
      expect.objectContaining({
        p_account_number: validScope.accountNumber,
        p_merchant_id: validScope.merchantId,
      })
    );
  });

  it('fails closed when account number, session id, or rpc fails or throws', async () => {
    const rpcFalse = vi.fn().mockResolvedValue({ data: false, error: null });
    await expect(
      hasDvaPostLogoutFinalizationEvidence({
        ...validScope,
        accountNumber: 'bad',
        supabase: { rpc: rpcFalse } as unknown as ProbeSupabase,
      })
    ).resolves.toBe(false);
    expect(rpcFalse).not.toHaveBeenCalled();

    await expect(
      hasDvaPostLogoutFinalizationEvidence({
        ...validScope,
        agenticSessionId: 'x'.repeat(257),
        supabase: { rpc: rpcFalse } as unknown as ProbeSupabase,
      })
    ).resolves.toBe(false);
    expect(rpcFalse).not.toHaveBeenCalled();

    await expect(
      hasDvaPostLogoutFinalizationEvidence({
        ...validScope,
        supabase: {} as unknown as ProbeSupabase,
      })
    ).resolves.toBe(false);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rpcError = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'missing fn' } });
    await expect(
      hasDvaPostLogoutFinalizationEvidence({
        ...validScope,
        supabase: { rpc: rpcError } as unknown as ProbeSupabase,
      })
    ).resolves.toBe(false);

    const rpcThrow = vi.fn().mockRejectedValue(new Error('network error'));
    await expect(
      hasDvaPostLogoutFinalizationEvidence({
        ...validScope,
        supabase: { rpc: rpcThrow } as unknown as ProbeSupabase,
      })
    ).resolves.toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });
});
