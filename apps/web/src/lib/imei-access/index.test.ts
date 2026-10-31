import { createHmac, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createImeiAccessClient } from './index';

vi.mock('server-only', () => ({}));
afterEach(() => vi.unstubAllEnvs());
const context = {
  userId: 'actor',
  merchantId: 'merchant',
  customerId: 'customer',
};

it('fails closed without a dedicated signing secret', () => {
  vi.stubEnv('IMEI_ACCESS_SIGNING_SECRET', '');
  expect(() =>
    createImeiAccessClient({ ...context, supabase: {} as SupabaseClient })
  ).toThrow('unavailable');
});

it('signs the exact operation bytes and binds actor, customer, merchant and expiry', async () => {
  const secret = randomBytes(32).toString('hex');
  vi.stubEnv('IMEI_ACCESS_SIGNING_SECRET', secret);
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: { id: 'lookup' }, error: null });
  const access = createImeiAccessClient({
    ...context,
    supabase: { rpc } as unknown as SupabaseClient,
  });
  await expect(
    access.cache('lookup', { cached_response: { data: 'é' } })
  ).resolves.toEqual({ data: { id: 'lookup' }, error: null });
  const [name, transport] = rpc.mock.calls[0];
  expect(name).toBe('imei_lookup_access');
  const payload = JSON.parse(transport.p_payload);
  expect(payload).toMatchObject({
    version: 1,
    actor: 'actor',
    merchant: 'merchant',
    customer: 'customer',
    operation: 'cache',
    args: { lookup_id: 'lookup' },
  });
  expect(payload.expiresAt - payload.issuedAt).toBe(120);
  expect(transport.p_signature).toBe(
    createHmac('sha256', secret)
      .update(`baci:imei-access:v1:${transport.p_payload}`)
      .digest('hex')
  );
});

it('rejects RPC names outside the exact payment and lookup state allowlist', () => {
  vi.stubEnv('IMEI_ACCESS_SIGNING_SECRET', 'x'.repeat(32));
  const rpc = vi.fn();
  const access = createImeiAccessClient({
    ...context,
    supabase: { rpc } as unknown as SupabaseClient,
  });
  expect(() => access.rpc('sync_petrock_imei_provider_products', {})).toThrow(
    'Unsupported'
  );
  expect(rpc).not.toHaveBeenCalled();
});

it('reads durable payment state only through the signed owned lookup operation', async () => {
  vi.stubEnv('IMEI_ACCESS_SIGNING_SECRET', 'x'.repeat(32));
  const rpc = vi.fn().mockResolvedValue({
    data: { debited: true, refunded: false },
    error: null,
  });
  const access = createImeiAccessClient({
    ...context,
    supabase: { rpc } as unknown as SupabaseClient,
  });
  await expect(access.readPaymentState('lookup')).resolves.toEqual({
    data: { debited: true, refunded: false },
    error: null,
  });
  expect(JSON.parse(rpc.mock.calls[0][1].p_payload)).toMatchObject({
    actor: context.userId,
    merchant: context.merchantId,
    customer: context.customerId,
    operation: 'read_payment_state',
    args: { lookup_id: 'lookup' },
  });
});

it('binds known-unsubmitted cancellation to the signed actor and owned lookup', async () => {
  vi.stubEnv('IMEI_ACCESS_SIGNING_SECRET', randomBytes(32).toString('hex'));
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  const access = createImeiAccessClient({
    ...context,
    supabase: { rpc } as unknown as SupabaseClient,
  });
  await expect(
    access.rpc('cancel_unsubmitted_petrock_imei_lookup', {
      p_lookup_id: 'lookup',
    })
  ).resolves.toEqual({ data: true, error: null });
  expect(rpc.mock.calls[0][0]).toBe('imei_lookup_access');
  expect(JSON.parse(rpc.mock.calls[0][1].p_payload)).toMatchObject({
    actor: context.userId,
    customer: context.customerId,
    merchant: context.merchantId,
    operation: 'cancel_unsubmitted_petrock_imei_lookup',
    args: { p_lookup_id: 'lookup' },
  });
});

it('signs attempt claims for the authenticated customer and fingerprint', async () => {
  vi.stubEnv('IMEI_ACCESS_SIGNING_SECRET', 'x'.repeat(32));
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: { idempotency_key: 'canonical' }, error: null });
  const access = createImeiAccessClient({
    ...context,
    supabase: { rpc } as unknown as SupabaseClient,
  });
  await access.claimAttempt({
    tier: 'blacklist',
    imei_hash: 'a'.repeat(64),
    idempotency_key: 'requested',
  });
  expect(rpc.mock.calls[0][0]).toBe('imei_claim_attempt');
  expect(JSON.parse(rpc.mock.calls[0][1].p_payload)).toMatchObject({
    actor: context.userId,
    customer: context.customerId,
    merchant: context.merchantId,
    operation: 'claim_attempt',
    args: {
      tier: 'blacklist',
      imei_hash: 'a'.repeat(64),
      idempotency_key: 'requested',
    },
  });
});
