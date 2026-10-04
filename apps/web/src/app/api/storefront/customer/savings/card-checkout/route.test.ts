import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prefundedCardCheckoutFixture } from '@/lib/piggyvest/prefunded-card-checkout.test-fixture';
import { prefundedCardCheckoutPublicSchemas } from '@/schemas/prefunded-card-checkout-public-runtime';
import * as routeExports from './route';
import { GET, PATCH, POST } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  runtime: vi.fn(),
  capability: vi.fn(),
  start: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://staging-auth.ogabassey.com',
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/piggyvest/prefunded-card-checkout-public-runtime', () => ({
  readPrefundedCardCheckoutPublicRuntime: mocks.runtime,
}));

const fixture = prefundedCardCheckoutFixture();
const origin = 'https://staging.ogabassey.com';
const path = '/api/storefront/customer/savings/card-checkout';
const capability = {
  goalId: fixture.customerRequest.goalId,
  enabled: true,
  maximumAmountKobo: 250000,
  currency: 'NGN',
};
const state = {
  intentId: fixture.intent.intentId,
  goalId: fixture.customerRequest.goalId,
  amountKobo: fixture.customerRequest.amountKobo,
  currency: 'NGN',
  status: 'ready',
  authorizationUrl: fixture.session.authorizationUrl,
};

function request({
  body,
  method,
  query,
}: {
  body?: unknown;
  method: 'GET' | 'PATCH' | 'POST';
  query?: string;
}) {
  return new NextRequest(`${origin}${path}${query ? `?${query}` : ''}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      host: 'staging.ogabassey.com',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({
    error: null,
    supabase: { auth: { getUser: vi.fn() } },
    user: { id: fixture.customerIdentity.actorId },
  });
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.runtime.mockReturnValue({
    publicOrigin: origin,
    mutationsEnabled: true,
    customer: () => ({
      capability: mocks.capability,
      refresh: mocks.refresh,
      start: mocks.start,
    }),
  });
  mocks.capability.mockResolvedValue(capability);
  mocks.start.mockResolvedValue(state);
  mocks.refresh.mockResolvedValue(state);
});

describe('first-card savings checkout HTTP boundary', () => {
  it('uses default route configuration compatible with Cache Components', () => {
    expect(routeExports).not.toHaveProperty('dynamic');
    expect(routeExports).not.toHaveProperty('runtime');
  });
  it('reports checkout disabled while the financial processing chain is not activated', async () => {
    mocks.runtime.mockReturnValue({
      publicOrigin: origin,
      mutationsEnabled: false,
      customer: () => ({ capability: mocks.capability }),
    });

    const response = await GET(
      request({
        method: 'GET',
        query: `goalId=${fixture.customerRequest.goalId}`,
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ...capability,
      enabled: false,
      maximumAmountKobo: 0,
    });
  });

  it.each([
    undefined,
    false,
  ])('refuses checkout mutations when the financial activation flag is %s', async (mutationsEnabled) => {
    const customer = vi.fn();
    mocks.runtime.mockReturnValue({
      publicOrigin: origin,
      mutationsEnabled,
      customer,
    });

    const started = await POST(
      request({ body: fixture.customerRequest, method: 'POST' })
    );
    const refreshed = await PATCH(
      request({ body: fixture.customerSelection, method: 'PATCH' })
    );

    expect(started.status).toBe(503);
    expect(refreshed.status).toBe(503);
    expect(customer).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('authenticates before checking CSRF or composing the restricted runtime', async () => {
    mocks.auth.mockResolvedValue({
      error: 'Unauthorized',
      supabase: null,
      user: null,
    });

    const response = await POST(
      request({ body: fixture.customerRequest, method: 'POST' })
    );

    expect(response.status).toBe(401);
    expect(mocks.csrf).not.toHaveBeenCalled();
    expect(mocks.runtime).not.toHaveBeenCalled();
  });

  it('returns the strict enabled capability only from the configured eligible runtime', async () => {
    const response = await GET(
      request({
        method: 'GET',
        query: `goalId=${fixture.customerRequest.goalId}`,
      })
    );

    expect(response.status).toBe(200);
    expect(
      prefundedCardCheckoutPublicSchemas.capability.parse(await response.json())
    ).toEqual(capability);
    expect(mocks.capability).toHaveBeenCalledWith({
      goalId: fixture.customerRequest.goalId,
    });
  });

  it('fails closed when checkout runtime configuration is unavailable', async () => {
    mocks.runtime.mockReturnValue(null);

    const response = await GET(
      request({
        method: 'GET',
        query: `goalId=${fixture.customerRequest.goalId}`,
      })
    );

    expect(response.status).toBe(503);
    expect(mocks.capability).not.toHaveBeenCalled();
  });

  it('rejects client-supplied customer authority before composing checkout', async () => {
    const response = await POST(
      request({
        body: {
          ...fixture.customerRequest,
          customerId: fixture.customerIdentity.customerId,
        },
        method: 'POST',
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.runtime).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('requires CSRF before starting a one-time card checkout', async () => {
    mocks.csrf.mockResolvedValue({ valid: false });

    const response = await POST(
      request({ body: fixture.customerRequest, method: 'POST' })
    );

    expect(response.status).toBe(403);
    expect(mocks.runtime).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('starts with only the existing customer request and returns public state', async () => {
    const response = await POST(
      request({ body: fixture.customerRequest, method: 'POST' })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(state);
    expect(mocks.start).toHaveBeenCalledWith(fixture.customerRequest);
  });

  it('requires CSRF before refreshing provider verification', async () => {
    mocks.csrf.mockResolvedValue({ valid: false });

    const response = await PATCH(
      request({ body: fixture.customerSelection, method: 'PATCH' })
    );

    expect(response.status).toBe(403);
    expect(mocks.runtime).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('refreshes the selected first-card intent without exposing private state', async () => {
    const response = await PATCH(
      request({ body: fixture.customerSelection, method: 'PATCH' })
    );

    expect(response.status).toBe(200);
    expect(
      prefundedCardCheckoutPublicSchemas.state.parse(await response.json())
    ).toEqual(state);
    expect(mocks.refresh).toHaveBeenCalledWith(fixture.customerSelection);
  });
});
