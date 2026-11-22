import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  search: vi.fn(),
  tenant: vi.fn(),
  currency: vi.fn(),
  wish: vi.fn(),
}));
vi.mock('@/ai/generate-object-with-chain', () => ({
  generateObjectWithChain: mocks.generate,
}));
vi.mock('@/ai/chat-catalog-handlers', () => ({
  handleSearchProducts: mocks.search,
}));
vi.mock('@/ai/provider', async (importOriginal) => ({
  sanitizePromptInput: (await importOriginal<typeof import('@/ai/provider')>())
    .sanitizePromptInput,
  AI_RATE_LIMITS: {
    chatAutoReplyConversation: { requests: 6, windowMs: 60_000 },
    chatAutoReplyMerchant: { requests: 60, windowMs: 60_000 },
  },
  checkRateLimit: () => ({ allowed: true, remaining: 5, resetIn: 1 }),
}));
vi.mock('@/lib/agentic/agentic-chat-tenant', () => ({
  resolveAgenticChatTenant: mocks.tenant,
}));
vi.mock('@/lib/chatwoot/merchant-currency', () => ({
  loadChatwootMerchantCurrency: mocks.currency,
}));
vi.mock('@/ai/chat-auto-reply-santa', () => ({
  answerSantaWish: mocks.wish,
}));

import { generateChatAutoReply } from './chat-auto-reply';
import { CHAT_AUTO_REPLY_SYSTEM_PROMPT } from './chat-auto-reply-prompt';

const MERCHANT = '11111111-1111-4111-8111-111111111111';
const input = {
  merchantId: MERCHANT,
  conversationId: 7,
  question: 'Santa, I wish for Demo Phone X at 90000',
  history: [],
};
const offer = {
  productId: 'p-1',
  slug: 's',
  name: 'Demo Phone X',
  catalogPrice: 100000,
  grantedPrice: 90000,
  currency: 'NGN',
};
const normal = { reply: 'Wish to Santa!', confidence: 0.9, needsHuman: false };

function setSanta(on: boolean, date: string) {
  if (on) vi.stubEnv('EKAETTE_CHATWOOT_SANTA_ENABLED', 'true');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(date));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tenant.mockResolvedValue({ merchantId: MERCHANT });
  mocks.currency.mockResolvedValue({ currency: 'NGN' });
  mocks.search.mockResolvedValue({ products: [], total: 0 });
  mocks.generate.mockResolvedValue({
    object: { ...normal, intent: 'wish' },
    providerName: 'x',
  });
  mocks.wish.mockResolvedValue({ reply: 'Ho ho ho, deal!', offers: [offer] });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('generateChatAutoReply in Santa mode', () => {
  it('flag off in December: unchanged prompt, no wish path', async () => {
    setSanta(false, '2026-12-10T12:00:00Z');
    const result = await generateChatAutoReply(input);
    expect(mocks.generate.mock.calls[0][0].system).toBe(
      CHAT_AUTO_REPLY_SYSTEM_PROMPT
    );
    expect(mocks.wish).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.santaOffers).toBeUndefined();
  });

  it('a wish in December returns Santa and the verified offer', async () => {
    setSanta(true, '2026-12-10T12:00:00Z');
    const result = await generateChatAutoReply(input);
    expect(mocks.generate.mock.calls[0][0].system).toContain('Santa mode');
    expect(result).toMatchObject({
      ok: true,
      reply: { reply: 'Ho ho ho, deal!' },
      santaOffers: [offer],
    });
  });

  it('outside December there is no wish path even with the flag on', async () => {
    setSanta(true, '2026-11-22T12:00:00Z');
    const result = await generateChatAutoReply(input);
    expect(mocks.wish).not.toHaveBeenCalled();
    expect(mocks.generate.mock.calls[0][0].system).toBe(
      CHAT_AUTO_REPLY_SYSTEM_PROMPT
    );
    expect(result.ok && result.reply.reply).toBe('Wish to Santa!');
  });

  it('a non-wish message gets the normal answer, no offers', async () => {
    setSanta(true, '2026-12-10T12:00:00Z');
    mocks.generate.mockResolvedValue({
      object: { ...normal, intent: 'details' },
      providerName: 'x',
    });
    const result = await generateChatAutoReply(input);
    expect(mocks.wish).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      reply: { reply: 'Wish to Santa!' },
    });
    expect(result.ok && result.santaOffers).toBeUndefined();
  });

  it('an unsure wish (low confidence) is treated as normal help', async () => {
    setSanta(true, '2026-12-10T12:00:00Z');
    mocks.generate.mockResolvedValue({
      object: { ...normal, confidence: 0.4, intent: 'wish' },
      providerName: 'x',
    });
    await generateChatAutoReply(input);
    expect(mocks.wish).not.toHaveBeenCalled();
  });

  it('a failed wish falls back to the normal answer', async () => {
    setSanta(true, '2026-12-10T12:00:00Z');
    mocks.wish.mockRejectedValue(new Error('providers down'));
    const errors = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const result = await generateChatAutoReply(input);
    errors.mockRestore();
    expect(result).toMatchObject({
      ok: true,
      reply: { reply: 'Wish to Santa!' },
    });
    expect(result.ok && result.santaOffers).toBeUndefined();
  });
});
