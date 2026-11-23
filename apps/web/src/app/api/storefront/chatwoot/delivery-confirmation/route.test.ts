import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  cartVersion: 1,
  stageEnabled: true,
  google: vi.fn(),
  classify: vi.fn(),
}));

vi.mock('@/ai/generate-object-with-chain', () => ({
  generateObjectWithChain: fixture.classify,
}));
vi.mock('@/ai/provider', () => ({
  sanitizePromptInput: (value: string) => ({ value }),
}));
vi.mock('@/app/api/chat/ogabassey-model-providers', () => ({
  getOgabasseyPreferredProviders: () => [{ name: 'openai:fixture' }],
  OGABASSEY_MODEL_PROVIDER_OPTIONS: {},
}));
vi.mock('@/app/api/places/google-autocomplete', () => ({
  fetchGoogleAutocomplete: fixture.google,
}));
vi.mock('@/config/oxygen-storefront-staging', () => ({
  isOxygenStorefrontStagingEnabled: () => fixture.stageEnabled,
}));
vi.mock('@/lib/cart/request-quota', () => ({
  checkCartQuota: async () => ({ allowed: true }),
}));
vi.mock('@/lib/chatwoot/cart-context', () => ({
  loadChatwootCartContext: async () => ({
    ok: true,
    binding: {},
    state: {
      merchantId: 'staging-store',
      cartId: 'cart',
      cartVersion: fixture.cartVersion,
    },
    principal: { principalId: 'staging-shopper' },
  }),
}));
vi.mock('@/lib/chatwoot/commerce-context', () => ({
  challengePrivateKeyPem: () => 'synthetic-only-key-for-the-match-test',
  verifyChatwootSessionCapability: async () => ({
    conversationId: 41,
    visitorTokenSha256: 'fixture-visitor',
  }),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: async () => ({ valid: true }),
}));

import { POST } from './route';

function call(body: Record<string, unknown>) {
  return POST(
    new NextRequest(
      'https://localhost/api/storefront/chatwoot/delivery-confirmation',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: 41,
          sessionToken: 'fixture-session',
          ...body,
        }),
      }
    )
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('EKAETTE_CHATWOOT_CHECKOUT_ENABLED', 'true');
  fixture.cartVersion = 1;
  fixture.stageEnabled = true;
});

describe('staging chat delivery', () => {
  it('routes a product question without calling Google', async () => {
    fixture.classify.mockResolvedValueOnce({
      object: { decision: 'side_question' },
    });
    const response = await call({
      action: 'search',
      address: 'Does it come with a charger?',
    });
    expect(await response.json()).toEqual({ decision: 'side_question' });
    expect(fixture.google).not.toHaveBeenCalled();
  });

  it('requires the exact signed address and the same cart before classifying confirmation', async () => {
    fixture.classify.mockResolvedValueOnce({ object: { decision: 'address' } });
    fixture.google.mockResolvedValueOnce({
      status: 200,
      body: {
        predictions: [
          { placeId: 'google-fixture', fullText: '15 Example Road, Ikeja' },
        ],
      },
    });
    const search = await call({
      action: 'search',
      address: '15 Example Road, Ikeja',
    });
    const { match } = await search.json();
    expect(match).toMatchObject({
      label: '15 Example Road, Ikeja',
      proof: expect.any(String),
    });

    const altered = await call({
      action: 'decide',
      answer: 'Yes',
      match: { ...match, label: '16 Example Road, Ikeja' },
    });
    expect(altered.status).toBe(409);
    fixture.cartVersion = 2;
    const stale = await call({ action: 'decide', answer: 'Yes', match });
    expect(stale.status).toBe(409);
    expect(fixture.classify).toHaveBeenCalledTimes(1);

    fixture.cartVersion = 1;
    fixture.classify.mockResolvedValueOnce({
      object: { decision: 'confirmed' },
    });
    const confirmed = await call({
      action: 'decide',
      answer: 'Yes, that is correct.',
      match,
    });
    expect(await confirmed.json()).toEqual({ decision: 'confirmed' });
  });

  it('leaves the route dark outside staging', async () => {
    fixture.stageEnabled = false;
    expect(
      (await call({ action: 'search', address: 'Example Road' })).status
    ).toBe(404);
    expect(fixture.classify).not.toHaveBeenCalled();
  });
});
