// @vitest-environment node
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { GET } from './route';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  runtime: vi.fn(),
  identity: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/piggyvest/primary-wallet-runtime', () => ({
  readPrimaryWalletRuntime: mocks.runtime,
}));
vi.mock('@/lib/piggyvest/primary-wallet-identity', () => ({
  resolvePrimaryWalletIdentity: mocks.identity,
}));

const merchantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const get = () =>
  GET(
    new NextRequest(
      'https://example.com/api/storefront/customer/wallet-pin/status'
    )
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv(
    'WALLET_PIN_PEPPER',
    createHash('sha256').update('s5s-status-pepper').digest('hex')
  );
  mocks.auth.mockResolvedValue({
    user: { id: userId },
    supabase: { rpc: mocks.rpc },
  });
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.runtime.mockReturnValue({ onboarding: { merchantId } });
  mocks.identity.mockResolvedValue({ merchantId, customerId: 'c', userId });
});

it.each([
  [
    { status: 'not_set' },
    {
      hasPin: false,
      resetRequired: false,
      available: true,
      signInConfirmationRequired: false,
    },
  ],
  [
    { status: 'unavailable' },
    {
      hasPin: false,
      resetRequired: false,
      available: false,
      signInConfirmationRequired: false,
    },
  ],
  [
    { status: 'locked', lockedUntil: '2026-11-03T12:30:00Z' },
    {
      hasPin: true,
      resetRequired: false,
      available: true,
      signInConfirmationRequired: false,
    },
  ],
])('maps %j', async (state, expected) => {
  mocks.rpc.mockResolvedValue({ data: state, error: null });
  expect(await (await get()).json()).toEqual({ primary: true, ...expected });
});

it('reports unavailable, not an error, when the pepper is unusable', async () => {
  vi.stubEnv('WALLET_PIN_PEPPER', '');
  expect(await (await get()).json()).toEqual({
    primary: true,
    hasPin: false,
    resetRequired: false,
    available: false,
    signInConfirmationRequired: false,
  });
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('never exposes the salt, lock details or any hash', async () => {
  mocks.rpc.mockResolvedValue({
    data: {
      status: 'set',
      kdfVersion: 1,
      salt: 'ab'.repeat(16),
      attemptsRemaining: 5,
    },
    error: null,
  });
  const text = await (await get()).text();
  expect(text).not.toContain('abab');
  expect(Object.keys(JSON.parse(text)).sort()).toEqual([
    'available',
    'hasPin',
    'primary',
    'resetRequired',
    'signInConfirmationRequired',
  ]);
});

it('answers 503 with a stable code when the database fails', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: 'down' } });
  const res = await get();
  expect(res.status).toBe(503);
  expect(await res.json()).toMatchObject({ code: 'PIN_UNAVAILABLE' });
});
