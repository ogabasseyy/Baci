import { expect, it } from 'vitest';
import {
  type StorefrontAgentUiEvent,
  storefrontAgentUiContract,
} from '@/schemas/storefront-agent-ui-contract';
import { recoverOllamaChatResponse } from './recover-ollama-chat-response';
import { CUSTOMER_CHAT_FALLBACK_TEXT } from './route-helpers';

const events: StorefrontAgentUiEvent[] = [
  {
    type: 'present_products',
    intent: 'discover',
    title: 'Phones',
    products: [
      {
        id: 'phone',
        name: 'Phone',
        brand: null,
        category: null,
        description: null,
        hasVariants: false,
        imageUrl: null,
        manageStock: false,
        price: 10,
        slug: null,
        stock: null,
      },
    ],
  },
];
const request = () =>
  new Request('https://example.com/api/chat', {
    headers: { accept: storefrontAgentUiContract.mediaType },
  });

it.each([
  null,
  `${storefrontAgentUiContract.mediaType}; q=0, text/plain`,
])('allows cloud fallback when cards cannot be rendered: %s', async (accept) => {
  const req = new Request('https://example.com/api/chat', {
    headers: accept ? { accept } : {},
  });
  expect(
    await recoverOllamaChatResponse(req, new Error('failed'), false, events)
  ).toBeNull();
});

it('returns trusted read-only cards after generation failure', async () => {
  const response = await recoverOllamaChatResponse(
    request(),
    new Error('failed'),
    false,
    events
  );
  expect(await response?.json()).toMatchObject({
    events,
    text: 'I found these live catalog options for you.',
  });
});
it('keeps the no-replay static fallback after a commerce side effect', async () => {
  const response = await recoverOllamaChatResponse(
    request(),
    new Error('failed'),
    true,
    events
  );
  expect(await response?.json()).toMatchObject({
    events,
    text: CUSTOMER_CHAT_FALLBACK_TEXT,
  });
});
it('allows cloud fallback without usable events or side effects', async () => {
  expect(
    await recoverOllamaChatResponse(request(), new Error('failed'), false, [])
  ).toBeNull();
});
it('honors a disconnected client even when cards are available', async () => {
  const controller = new AbortController();
  controller.abort();
  const response = await recoverOllamaChatResponse(
    new Request(request(), { signal: controller.signal }),
    new Error('failed'),
    false,
    events
  );
  expect(response?.status).toBe(499);
});
