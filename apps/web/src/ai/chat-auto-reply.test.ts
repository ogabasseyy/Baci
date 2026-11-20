import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  search: vi.fn(),
  tenant: vi.fn(),
  currency: vi.fn(),
  rateLimit: vi.fn(),
}));
vi.mock('@/ai/generate-object-with-chain', () => ({
  generateObjectWithChain: mocks.generate,
}));
vi.mock('@/ai/chat-catalog-handlers', () => ({
  handleSearchProducts: mocks.search,
}));
vi.mock('@/ai/provider', () => ({
  AI_RATE_LIMITS: {
    chatAutoReplyConversation: { requests: 6, windowMs: 60_000 },
    chatAutoReplyMerchant: { requests: 60, windowMs: 60_000 },
  },
  checkRateLimit: mocks.rateLimit,
}));
vi.mock('@/lib/agentic/agentic-chat-tenant', () => ({
  resolveAgenticChatTenant: mocks.tenant,
}));
vi.mock('@/lib/chatwoot/merchant-currency', () => ({
  loadChatwootMerchantCurrency: mocks.currency,
}));

import { generateChatAutoReply } from './chat-auto-reply';

const MERCHANT = '11111111-1111-4111-8111-111111111111';
const input = {
  merchantId: MERCHANT,
  conversationId: 7,
  question: 'Do you have the Demo Phone X?',
  history: [{ role: 'user' as const, content: 'hi' }],
};
const reply = { reply: 'Yes.', confidence: 0.9, needsHuman: false };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rateLimit.mockReturnValue({ allowed: true, remaining: 5, resetIn: 1 });
  mocks.tenant.mockResolvedValue({ merchantId: MERCHANT });
  mocks.currency.mockResolvedValue({ currency: 'NGN' });
  mocks.search.mockResolvedValue({
    products: [{ name: 'Demo Phone X', price: 450000, stock: 2 }],
    total: 1,
  });
  mocks.generate.mockResolvedValue({ object: reply, providerName: 'x' });
});

describe('generateChatAutoReply', () => {
  it('returns the validated draft, grounded in the store catalog', async () => {
    expect(await generateChatAutoReply(input)).toEqual({ ok: true, reply });
    const call = mocks.generate.mock.calls[0][0];
    const last = call.messages.at(-1);
    expect(last.content).toContain('Demo Phone X | NGN 450000 | in stock');
    expect(call.messages[0]).toEqual({ role: 'user', content: 'hi' });
  });

  it('rate limits per conversation and per store', async () => {
    await generateChatAutoReply(input);
    const keys = mocks.rateLimit.mock.calls.map((call) => call[0]);
    expect(keys).toEqual([
      `chat-auto-reply:conversation:${MERCHANT}:7`,
      `chat-auto-reply:merchant:${MERCHANT}`,
    ]);
  });

  it('does not call the model once a limit is reached', async () => {
    mocks.rateLimit.mockReturnValueOnce({
      allowed: false,
      remaining: 0,
      resetIn: 1,
    });
    expect(await generateChatAutoReply(input)).toEqual({
      ok: false,
      reason: 'rate_limited',
    });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("never shows another store's catalog", async () => {
    mocks.tenant.mockResolvedValue({ merchantId: 'someone-else' });
    await generateChatAutoReply(input);
    expect(mocks.search).not.toHaveBeenCalled();
    const last = mocks.generate.mock.calls[0][0].messages.at(-1);
    expect(last.content).toContain('No matching products were found.');
  });

  it('hands over instead of telling the model nothing matched when the catalog search fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.search.mockRejectedValue(new Error('down'));
    expect(await generateChatAutoReply(input)).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('fails closed when the model chain is exhausted', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.generate.mockRejectedValue(new Error('all providers failed'));
    expect(await generateChatAutoReply(input)).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('rejects an empty reply that does not hand over', async () => {
    await generateChatAutoReply(input);
    const { validate } = mocks.generate.mock.calls[0][0];
    expect(validate({ reply: '', confidence: 0.9, needsHuman: false })).toMatch(
      /empty/
    );
    expect(
      validate({ reply: '', confidence: 0.9, needsHuman: true })
    ).toBeNull();
  });
});
