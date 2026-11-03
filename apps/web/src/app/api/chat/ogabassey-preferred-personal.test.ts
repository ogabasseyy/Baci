import { beforeEach, expect, it, vi } from 'vitest';
import type { AgenticChatTenant } from '@/lib/agentic/agentic-chat-tenant';

const mocks = vi.hoisted(() => ({ fast: vi.fn(), conversation: vi.fn() }));
vi.mock('./fast-catalog-response', () => ({
  tryFastCatalogResponse: mocks.fast,
}));
vi.mock('./ogabassey-conversation', () => ({
  runOgabasseyConversation: mocks.conversation,
}));

import { interpretFastCatalogIntent } from './fast-catalog-intent';
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
  vi.resetAllMocks();
  mocks.fast.mockResolvedValue(new Response('Catalog result'));
  mocks.conversation.mockResolvedValue(null);
});

it('does not search the catalog for an explicitly supplied phone number', async () => {
  const content = 'My phone is 07012345678';
  expect(
    interpretFastCatalogIntent(
      [content],
      [{ id: 'phones', name: 'Smartphones', slug: 'smartphones' }]
    )?.kind
  ).toBe('search');

  const result = await tryOgabasseyPreferredResponse(
    new Request('https://ogabassey.com/api/chat'),
    [{ role: 'user', content }],
    tenant,
    'auto',
    () => 30_000
  );

  expect(await result?.text()).not.toContain('07012345678');
  expect(mocks.fast).not.toHaveBeenCalled();
  expect(mocks.conversation).not.toHaveBeenCalled();
});

it.each([
  '07012345678',
  'My email is jane@example.com',
])('does not forward an explicitly supplied contact detail: %s', async (content) => {
  const result = await tryOgabasseyPreferredResponse(
    new Request('https://ogabassey.com/api/chat'),
    [{ role: 'user', content }],
    tenant,
    'auto',
    () => 30_000
  );

  expect(await result?.text()).not.toContain(content);
  expect(mocks.fast).not.toHaveBeenCalled();
  expect(mocks.conversation).not.toHaveBeenCalled();
});

it.each([
  'Show me an iPhone under 1000000',
  'My phone is iPhone 16, which charger fits?',
])('still checks the catalog for a product request: %s', async (content) => {
  const result = await tryOgabasseyPreferredResponse(
    new Request('https://ogabassey.com/api/chat'),
    [{ role: 'user', content }],
    tenant,
    'auto',
    () => 30_000
  );

  expect(await result?.text()).toBe('Catalog result');
  expect(mocks.fast).toHaveBeenCalledOnce();
});
