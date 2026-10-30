import { createHash, createHmac, randomBytes } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createAddressBudgetClient } from './scoped-client';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(
    (
      _url: string,
      _key: string,
      _options: { global: { headers: { Authorization: string } } }
    ) => ({})
  ),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
const request = {
  provider: 'google' as const,
  kind: 'autocomplete' as const,
  apiKey: 'synthetic-provider-key',
  reservationId: '00000000-0000-4000-8000-000000000001',
};
it('signs one provider/credential/attempt capability without exposing the provider key', () => {
  const now = new Date('2026-10-30T08:00:00Z');
  const signingSecret = randomBytes(32).toString('hex');
  createAddressBudgetClient(request, {
    now,
    anonKey: 'synthetic-anon',
    supabaseUrl: 'https://project.example.test',
    signer: { type: 'legacy-secret', secret: signingSecret },
  });
  const header =
    mocks.createClient.mock.lastCall?.[2].global.headers.Authorization;
  expect(header).toBeDefined();
  const [protectedHeader, payload, signature] = String(header)
    .replace('Bearer ', '')
    .split('.');
  expect(signature).toBe(
    createHmac('sha256', signingSecret)
      .update(`${protectedHeader}.${payload}`)
      .digest('base64url')
  );
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  expect(claims).toEqual({
    aud: 'authenticated',
    role: 'address_budget_reserver',
    address_provider: 'google',
    address_request_kind: 'autocomplete',
    address_credential_hash: createHash('sha256')
      .update(request.apiKey)
      .digest('hex'),
    address_reservation_id: request.reservationId,
    iat: 1793347200,
    exp: 1793347260,
  });
  expect(JSON.stringify(claims)).not.toContain(request.apiKey);
});
it('rejects blank credentials before constructing database authority', () => {
  mocks.createClient.mockClear();
  expect(() => createAddressBudgetClient({ ...request, apiKey: '' })).toThrow();
  expect(mocks.createClient).not.toHaveBeenCalled();
});
