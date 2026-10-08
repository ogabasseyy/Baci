import { beforeEach, describe, expect, it, vi } from 'vitest';
import { primaryWalletCardCheckoutFixture as fixture } from '@/lib/piggyvest/primary-wallet-card-checkout.test-fixture';
import { handlePrimaryWalletCardCheckout } from './primary-wallet-card-checkout-route';
import { primaryWalletCardCheckoutRouteFixture } from './primary-wallet-card-checkout-route.test-fixture';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  runtime: vi.fn(),
  service: vi.fn(),
  initialize: vi.fn(),
  status: vi.fn(),
  execute: vi.fn(),
  provider: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/piggyvest/primary-wallet-card-checkout-runtime', () => ({
  readPrimaryWalletCardCheckoutRuntime: mocks.runtime,
}));
vi.mock('@/lib/piggyvest/primary-wallet-card-checkout-executor', () => ({
  createPrimaryWalletCardCheckoutExecutor: mocks.execute,
}));
vi.mock('@/lib/piggyvest/primary-wallet-card-checkout-provider', () => ({
  createPrimaryWalletCardCheckoutProvider: mocks.provider,
}));
vi.mock('@/lib/piggyvest/primary-wallet-card-checkout-service', () => ({
  createPrimaryWalletCardCheckoutService: mocks.service,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.runtime.mockReturnValue({ settings: fixture.settings });
  mocks.service.mockReturnValue({
    initialize: mocks.initialize,
    status: mocks.status,
  });
  mocks.initialize.mockResolvedValue({
    operationId: fixture.intent.operationId,
    status: 'ready',
    authorizationUrl: 'https://checkout.paystack.com/fixture',
  });
  mocks.status.mockResolvedValue({
    operationId: fixture.intent.operationId,
    status: 'custody_pending',
  });
});
describe.each([
  'initialize',
  'status',
] as const)('authenticated primary card %s route', (action) => {
  it('returns 401 before CSRF, settings or database access when unauthenticated', async () => {
    const test = primaryWalletCardCheckoutRouteFixture(action);
    mocks.auth.mockResolvedValue({ user: null });
    expect(
      (await handlePrimaryWalletCardCheckout(test.request(), action)).status
    ).toBe(401);
    expect(mocks.csrf).not.toHaveBeenCalled();
    expect(mocks.runtime).not.toHaveBeenCalled();
  });
  it('rejects invalid CSRF before customer lookup', async () => {
    const test = primaryWalletCardCheckoutRouteFixture(action);
    mocks.auth.mockResolvedValue(test.auth);
    mocks.csrf.mockResolvedValue({ valid: false });
    expect(
      (await handlePrimaryWalletCardCheckout(test.request(), action)).status
    ).toBe(403);
    expect(test.auth.supabase.from).not.toHaveBeenCalled();
  });
  it('rejects request-selected customer scope before database access', async () => {
    const test = primaryWalletCardCheckoutRouteFixture(action);
    mocks.auth.mockResolvedValue(test.auth);
    expect(
      (
        await handlePrimaryWalletCardCheckout(
          test.request({ ...test.body, customerId: fixture.intent.customerId }),
          action
        )
      ).status
    ).toBe(400);
    expect(test.auth.supabase.from).not.toHaveBeenCalled();
  });
  it('returns 503 for a different configured merchant before database access', async () => {
    const test = primaryWalletCardCheckoutRouteFixture(action);
    mocks.auth.mockResolvedValue(test.auth);
    expect(
      (
        await handlePrimaryWalletCardCheckout(
          test.request({
            ...test.body,
            merchantId: '10000000-0000-4000-8000-000000000009',
          }),
          action
        )
      ).status
    ).toBe(503);
    expect(test.auth.supabase.from).not.toHaveBeenCalled();
  });
  it('rejects a customer owned by another authenticated user', async () => {
    const test = primaryWalletCardCheckoutRouteFixture(action);
    mocks.auth.mockResolvedValue(test.auth);
    test.query.maybeSingle.mockResolvedValue({
      data: {
        id: fixture.intent.customerId,
        merchant_id: fixture.intent.merchantId,
        user_id: '10000000-0000-4000-8000-000000000009',
        email: fixture.intent.email,
      },
      error: null,
    });
    expect(
      (await handlePrimaryWalletCardCheckout(test.request(), action)).status
    ).toBe(403);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('requires confirmed email before customer lookup', async () => {
    const test = primaryWalletCardCheckoutRouteFixture(action);
    mocks.auth.mockResolvedValue({
      ...test.auth,
      user: { ...test.auth.user, email_confirmed_at: null },
    });
    expect(
      (await handlePrimaryWalletCardCheckout(test.request(), action)).status
    ).toBe(409);
    expect(test.auth.supabase.from).not.toHaveBeenCalled();
  });
  it('fails closed on a customer query error', async () => {
    const test = primaryWalletCardCheckoutRouteFixture(action);
    mocks.auth.mockResolvedValue(test.auth);
    test.query.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'private details' },
    });
    expect(
      (await handlePrimaryWalletCardCheckout(test.request(), action)).status
    ).toBe(403);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('constructs scope from RLS identity and trusted integration only', async () => {
    const test = primaryWalletCardCheckoutRouteFixture(action);
    mocks.auth.mockResolvedValue(test.auth);
    const response = await handlePrimaryWalletCardCheckout(
      test.request(),
      action
    );
    expect(response.status).toBe(action === 'initialize' ? 200 : 202);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.service).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({
          customerId: fixture.intent.customerId,
          userId: fixture.intent.userId,
          integrationId: fixture.intent.integrationId,
        }),
      })
    );
    expect(test.query.eq).toHaveBeenCalledWith(
      'user_id',
      fixture.intent.userId
    );
  });
  it('does not expose provider errors or report completion on storage failure', async () => {
    const test = primaryWalletCardCheckoutRouteFixture(action);
    mocks.auth.mockResolvedValue(test.auth);
    mocks.initialize.mockRejectedValue(new Error('private details'));
    mocks.status.mockRejectedValue(new Error('private details'));
    const response = await handlePrimaryWalletCardCheckout(
      test.request(),
      action
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private details');
  });
});
