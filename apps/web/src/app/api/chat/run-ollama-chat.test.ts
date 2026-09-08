import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ generate: vi.fn(), execute: vi.fn() }));
vi.mock('@/lib/ollama-agentic-chat', () => ({
  createOllamaAgenticChatResponse: mocks.generate,
}));

import { runOllamaChat } from './run-ollama-chat';

const options = {
  baseUrl: 'https://ollama.example.com',
  model: 'test-model',
  executeToolCall: mocks.execute,
};

beforeEach(() => {
  vi.resetAllMocks();
});

it('returns the buffered successful response', async () => {
  mocks.generate.mockResolvedValue(new Response('Hello'));
  const response = await runOllamaChat(
    new Request('https://example.com'),
    [],
    options
  );
  expect(await response?.text()).toBe('Hello');
});

it('returns null to allow cloud fallback when no result was captured', async () => {
  mocks.generate.mockRejectedValue(new Error('Unavailable'));
  const response = await runOllamaChat(
    new Request('https://example.com'),
    [],
    options
  );
  expect(response).toBeNull();
});

it('uses the route-owned tool executor without resolving credentials itself', async () => {
  const call = {
    function: { name: 'getProductDetails', arguments: { productId: 'phone' } },
  };
  mocks.execute.mockResolvedValue('catalog result');
  mocks.generate.mockImplementation(
    async ({ executeToolCall }: Pick<typeof options, 'executeToolCall'>) => {
      return new Response(await executeToolCall(call));
    }
  );
  const response = await runOllamaChat(
    new Request('https://example.com'),
    [],
    options
  );
  expect(await response?.text()).toBe('catalog result');
  expect(mocks.execute).toHaveBeenCalledWith(call);
});
