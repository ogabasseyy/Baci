import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ generate: vi.fn(), model: vi.fn() }));
vi.mock('@/lib/ollama-agentic-chat', () => ({
  createOllamaAgenticChatResponse: mocks.generate,
}));
vi.mock('@/env', () => ({
  getAiChatModel: mocks.model,
  getOllamaBasicAuth: () => undefined,
}));

import { runOllamaChat } from './run-ollama-chat';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.model.mockReturnValue('test-model');
});

it('returns the buffered successful response', async () => {
  mocks.generate.mockResolvedValue(new Response('Hello'));
  const response = await runOllamaChat(
    new Request('https://example.com'),
    [],
    'session',
    'https://ollama.example.com'
  );
  expect(await response?.text()).toBe('Hello');
});

it('returns null to allow cloud fallback when no result was captured', async () => {
  mocks.generate.mockRejectedValue(new Error('Unavailable'));
  const response = await runOllamaChat(
    new Request('https://example.com'),
    [],
    'session',
    'https://ollama.example.com'
  );
  expect(response).toBeNull();
});

it('does not mask configuration errors as a recoverable backend failure', async () => {
  mocks.model.mockImplementation(() => {
    throw new Error('Invalid model');
  });
  const response = runOllamaChat(
    new Request('https://example.com'),
    [],
    'session',
    'https://ollama.example.com'
  );
  await expect(response).rejects.toThrow('Invalid model');
  expect(mocks.generate).not.toHaveBeenCalled();
});
