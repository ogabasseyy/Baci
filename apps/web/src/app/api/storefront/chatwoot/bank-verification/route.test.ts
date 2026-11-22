import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stagingEnabled: vi.fn(() => true),
  checkCsrf: vi.fn(async () => ({ valid: true })),
  authenticate: vi.fn<
    () => Promise<{ user: { id: string } | null; error: string | null }>
  >(async () => ({
    user: { id: 'user-1' },
    error: null,
  })),
  rateLimit: vi.fn(async () => ({ allowed: true })),
  loadContext: vi.fn(async () => ({
    ok: true as const,
    binding: { websiteToken: 'tok' },
    state: { merchantId: 'm-1' },
  })),
  verifyCapability: vi.fn(async () => ({ conversationId: 42 })),
  readConfig: vi.fn(() => null),
  getRedis: vi.fn(() => null),
  readOrRefreshBanks: vi.fn(),
  providerCall: vi.fn(),
  challengePrivateKeyPem: vi.fn(() => 'test-hmac-secret'),
}));

vi.mock('@/config/oxygen-storefront-staging', () => ({
  isOxygenStorefrontStagingEnabled: mocks.stagingEnabled,
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mocks.checkCsrf,
}));
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mocks.authenticate,
}));
vi.mock('@/lib/rate-limit', () => ({
  checkOxygenProviderRateLimit: mocks.rateLimit,
}));
vi.mock('@/lib/chatwoot/cart-context', () => ({
  loadChatwootCartContext: mocks.loadContext,
}));
vi.mock('@/lib/chatwoot/commerce-context', () => ({
  verifyChatwootSessionCapability: mocks.verifyCapability,
  challengePrivateKeyPem: mocks.challengePrivateKeyPem,
}));
vi.mock('@/lib/payments/oxygen/runtime-configuration', () => ({
  readOxygenRuntimeConfiguration: mocks.readConfig,
}));
vi.mock('@/lib/redis', () => ({
  getRedis: mocks.getRedis,
}));
vi.mock('@/lib/payments/oxygen/supported-bank-read-or-refresh', () => ({
  readOrRefreshSupportedBanks: mocks.readOrRefreshBanks,
}));
vi.mock('@/lib/payments/oxygen/runtime-connection', () => ({
  connectOxygenRuntime: () => ({
    provider: {
      environment: 'staging',
      call: mocks.providerCall,
    },
  }),
}));

import { POST } from './route';

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest(
    'https://localhost/api/storefront/chatwoot/bank-verification?merchantSlug=savings-synthetic',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

describe('POST /api/storefront/chatwoot/bank-verification', () => {
  beforeEach(() => {
    vi.stubEnv('EKAETTE_CHATWOOT_CHECKOUT_ENABLED', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('returns banks for an authenticated chat session', async () => {
    mocks.providerCall.mockResolvedValueOnce({
      Status: '00',
      Result: [{ Name: 'GTBank', SortCode: '058' }],
    });
    const res = await POST(
      makeRequest({
        action: 'banks',
        conversationId: 42,
        sessionToken: 'session-tok',
      })
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      banks: [{ name: 'GTBank', code: '058' }],
    });
  });

  it('resolves account name and returns only masked account number and verification reference (never raw account number)', async () => {
    const rawAccountNumber = '0123456789';
    mocks.providerCall.mockResolvedValueOnce({
      success: true,
      errorCode: 0,
      accountName: 'ADA OBI',
    });

    const res = await POST(
      makeRequest({
        action: 'resolve',
        conversationId: 42,
        sessionToken: 'session-tok',
        bankCode: '058',
        accountNumber: rawAccountNumber,
        phone: '+2348012345678',
      })
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(rawAccountNumber);
    const json = JSON.parse(text) as Record<string, unknown>;
    expect(json).toMatchObject({
      accountName: 'ADA OBI',
      maskedAccountNumber: '••••••6789',
    });
    expect(json.verificationReference).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects unauthenticated requests', async () => {
    mocks.authenticate.mockResolvedValueOnce({
      user: null,
      error: 'Unauthorized',
    });
    const res = await POST(
      makeRequest({
        action: 'banks',
        conversationId: 42,
        sessionToken: 'session-tok',
      })
    );
    expect(res.status).toBe(401);
  });
});
