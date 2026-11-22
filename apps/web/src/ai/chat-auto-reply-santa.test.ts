import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  text: vi.fn(),
  prompt: vi.fn(),
  verify: vi.fn(),
  log: vi.fn(),
}));
vi.mock('@/ai/generate-text-with-chain', () => ({
  generateTextWithChain: mocks.text,
}));
vi.mock('@/ai/santa-system-instruction', () => ({
  generateSantaPrompt: mocks.prompt,
  SANTA_CATALOG_TIMEOUT_MS: 4000,
}));
vi.mock('@/ai/chat-santa-offers', () => ({
  verifySantaAnswer: mocks.verify,
}));
vi.mock('@/app/api/chat/santa/santa-analytics', () => ({
  logSantaInteraction: mocks.log,
}));

import { answerSantaWish } from './chat-auto-reply-santa';

const tenant = {
  agenticCheckoutEnabled: false,
  businessName: 'Demo Store',
  currencyCode: 'NGN',
  merchantId: '11111111-1111-4111-8111-111111111111',
  merchantSlug: 'demo',
  priceNegotiationEnabled: true,
};
const offer = {
  productId: 'p-1',
  slug: 's',
  name: 'Demo Phone X',
  catalogPrice: 100000,
  grantedPrice: 90000,
  currency: 'NGN',
};
const input = {
  tenant,
  conversationId: 7,
  question: 'I wish for Demo Phone X at 90000',
  history: [{ role: 'user' as const, content: 'hi' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prompt.mockResolvedValue('SANTA SYSTEM');
  mocks.text.mockResolvedValue({ text: 'raw', providerName: 'x' });
  mocks.verify.mockResolvedValue({
    reply: 'Deal!',
    offers: [offer],
    dropped: false,
  });
  mocks.log.mockResolvedValue(undefined);
});

describe('answerSantaWish', () => {
  it('answers as Santa with the verified offer and records the grant', async () => {
    expect(await answerSantaWish(input)).toEqual({
      reply: 'Deal!',
      offers: [offer],
    });
    expect(mocks.text.mock.calls[0][0].system).toBe('SANTA SYSTEM');
    expect(mocks.log.mock.calls[0][0].response).toContain(
      'ACTION:ADD_TO_CART|PRODUCT:Demo Phone X|PRICE:90000'
    );
  });

  it('records a refusal without a directive', async () => {
    mocks.verify.mockResolvedValue({
      reply: 'I cannot approve that',
      offers: [],
      dropped: true,
    });
    expect(await answerSantaWish(input)).toEqual({
      reply: 'I cannot approve that',
      offers: [],
    });
    expect(mocks.log.mock.calls[0][0].response).not.toContain('ACTION:');
  });

  it('still answers when analytics fails', async () => {
    mocks.log.mockRejectedValue(new Error('insert refused'));
    const errors = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    await expect(answerSantaWish(input)).resolves.toMatchObject({
      reply: 'Deal!',
    });
    await Promise.resolve();
    errors.mockRestore();
  });

  it('lets a model failure reach the caller, which falls back', async () => {
    mocks.text.mockRejectedValue(new Error('all providers failed'));
    await expect(answerSantaWish(input)).rejects.toThrow();
  });
});
