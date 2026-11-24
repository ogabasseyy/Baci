import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stagingEnabled: vi.fn(() => true),
  checkCsrf: vi.fn(async () => ({ valid: true })),
  authenticate: vi.fn(async () => ({
    user: { id: 'user-1' },
    error: null,
  })),
  loadContext: vi.fn(async () => ({
    ok: true as const,
    binding: { websiteToken: 'tok' },
    state: { merchantId: 'm-1' },
    principal: { principalId: 'p-1' },
  })),
  verifyCapability: vi.fn(async () => ({ conversationId: 42 })),
  checkQuota: vi.fn(async () => ({ allowed: true })),
  generate: vi.fn(),
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
vi.mock('@/lib/chatwoot/cart-context', () => ({
  loadChatwootCartContext: mocks.loadContext,
}));
vi.mock('@/lib/chatwoot/commerce-context', () => ({
  verifyChatwootSessionCapability: mocks.verifyCapability,
}));
vi.mock('@/lib/cart/request-quota', () => ({
  checkCartQuota: mocks.checkQuota,
}));
vi.mock('@/app/api/chat/ogabassey-model-providers', () => ({
  getOgabasseyPreferredProviders: () => [{ name: 'openai:gpt-5-mini' }],
  OGABASSEY_MODEL_PROVIDER_OPTIONS: { openai: {} },
}));
vi.mock('@/ai/generate-object-with-chain', () => ({
  generateObjectWithChain: mocks.generate,
}));

import { POST } from './route';

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest(
    'https://localhost/api/storefront/chatwoot/checkout-turn?merchantSlug=savings-synthetic',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

describe('POST /api/storefront/chatwoot/checkout-turn', () => {
  beforeEach(() => {
    vi.stubEnv('EKAETTE_CHATWOOT_CHECKOUT_ENABLED', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('works outside staging when checkout is enabled and returns 404 when disabled', async () => {
    mocks.stagingEnabled.mockReturnValue(false);
    mocks.generate.mockResolvedValueOnce({
      object: { intent: 'confirm', selectedCode: null, reply: null },
    });
    const enabledRes = await POST(
      makeRequest({
        conversationId: 42,
        sessionToken: 'session-tok',
        step: 'confirm_payment',
        question: 'Would you like to make payment now?',
        answer: 'Yes, go ahead',
      })
    );
    expect(enabledRes.status).toBe(200);
    await expect(enabledRes.json()).resolves.toEqual({ intent: 'confirm' });

    vi.stubEnv('EKAETTE_CHATWOOT_CHECKOUT_ENABLED', 'false');
    const disabledRes = await POST(
      makeRequest({
        conversationId: 42,
        sessionToken: 'session-tok',
        step: 'confirm_payment',
        question: 'Would you like to make payment now?',
        answer: 'Yes, go ahead',
      })
    );
    expect(disabledRes.status).toBe(404);
  });

  it('passes the assistant question and shopper reply to the AI for natural understanding', async () => {
    mocks.generate.mockResolvedValueOnce({
      object: { intent: 'confirm', selectedCode: null, reply: null },
    });
    const res = await POST(
      makeRequest({
        conversationId: 42,
        sessionToken: 'session-tok',
        step: 'same_as_home',
        question: 'Is this delivery address also your home address?',
        answer: 'na my house be that, go ahead',
      })
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ intent: 'confirm' });
    expect(mocks.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            role: 'assistant',
            content: 'Is this delivery address also your home address?',
          },
          { role: 'user', content: 'na my house be that, go ahead' },
        ],
      })
    );
  });

  it('resolves natural bank names to an exact option code', async () => {
    mocks.generate.mockResolvedValueOnce({
      object: { intent: 'select_option', selectedCode: '058', reply: null },
    });
    const res = await POST(
      makeRequest({
        conversationId: 42,
        sessionToken: 'session-tok',
        step: 'select_bank',
        question: 'Which bank do you receive your salary in?',
        answer: 'I use GTB',
        options: [
          { code: '058', name: 'Guaranty Trust Bank' },
          { code: '044', name: 'Access Bank' },
        ],
      })
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      intent: 'select_option',
      selectedCode: '058',
    });
  });

  it.each([
    '0123456789',
    'my account number is 0123456789',
    '0123456789 please',
    '22234567890',
    'my BVN is 22234567890',
    'my phone is 08012345678',
  ])('rejects sensitive reply %s before it can reach the LLM', async (answer) => {
    const res = await POST(
      makeRequest({
        conversationId: 42,
        sessionToken: 'session-tok',
        step: 'account_number',
        question: 'What is your 10-digit account number?',
        answer,
      })
    );
    expect(res.status).toBe(400);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('answers side questions naturally on the account_number step when no digits are sent', async () => {
    mocks.generate.mockResolvedValueOnce({
      object: {
        intent: 'side_question',
        selectedCode: null,
        reply:
          'Yes, it is safe — I only use it to confirm your account name and never save the full number in chat.',
      },
    });
    const res = await POST(
      makeRequest({
        conversationId: 42,
        sessionToken: 'session-tok',
        step: 'account_number',
        question: 'What is your 10-digit Access Bank account number?',
        answer: 'Is my account number safe here?',
      })
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      intent: 'side_question',
      reply:
        'Yes, it is safe — I only use it to confirm your account name and never save the full number in chat.',
    });
  });
});
