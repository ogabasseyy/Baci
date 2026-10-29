import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AgenticChatTenant } from '@/lib/agentic/agentic-chat-tenant';

const mocks = vi.hoisted(() => ({ categories: vi.fn(), products: vi.fn() }));
vi.mock('./fast-catalog-data', () => ({
  loadFastCatalogCategories: mocks.categories,
  loadFastCatalogProducts: mocks.products,
}));

import { tryOgabasseyPreferredResponse } from './ogabassey-preferred-response';

const tenant = {
  agenticCheckoutEnabled: true,
  businessName: 'Ogabassey',
  currencyCode: 'NGN',
  merchantId: 'merchant-1',
  merchantSlug: 'ogabassey',
  priceNegotiationEnabled: true,
} as AgenticChatTenant;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('DEEPSEEK_API_KEY', '');
  mocks.categories.mockResolvedValue([
    { id: 'phones', name: 'Smartphones', slug: 'smartphones' },
  ]);
  mocks.products.mockResolvedValue([]);
});

afterEach(() => vi.unstubAllEnvs());

it.each([
  'What is your phone number?',
  "What's your phone no.?",
  'What is the store telephone number?',
  "What's Ogabassey's number?",
  'How can I contact you?',
  'How can I call you?',
  'What is your WhatsApp number?',
  'How do I contact support?',
])('routes contact questions to safe guidance without provider keys: %s', async (content) => {
  const response = await tryOgabasseyPreferredResponse(
    new Request('https://ogabassey.com/api/chat'),
    [{ role: 'user', content }],
    tenant,
    'auto',
    () => 30_000
  );
  expect(await response?.text()).toMatch(/contact page|contact support/i);
  expect(response?.headers.get('x-baci-chat-fallback')).not.toBe('static');
  expect(mocks.categories).not.toHaveBeenCalled();
  expect(mocks.products).not.toHaveBeenCalled();
});

it('answers a contact question even after an order conversation', async () => {
  const response = await tryOgabasseyPreferredResponse(
    new Request('https://ogabassey.com/api/chat'),
    [
      { role: 'user', content: 'Where is my order?' },
      { role: 'assistant', content: 'Check your account orders.' },
      { role: 'user', content: 'What is your phone number?' },
    ],
    tenant,
    'auto',
    () => 30_000
  );
  expect(await response?.text()).toMatch(/contact page|contact support/i);
  expect(mocks.categories).not.toHaveBeenCalled();
});
