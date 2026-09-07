import { beforeEach, expect, it, vi } from 'vitest';
import { resetProviderCooldowns } from '@/ai/provider-cooldown';
import type { TextProvider } from '@/ai/text-provider-chain';

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  createTools: vi.fn(),
  chain: vi.fn(),
}));
vi.mock('ai', () => ({ generateText: mocks.generateText }));
vi.mock('@/ai/text-provider-chain', () => ({
  getTextProviderChain: mocks.chain,
}));
vi.mock('./chat-tool-runtime', () => ({
  createAiSdkAgenticChatTools: mocks.createTools,
}));

import { runChatProviderChain } from './run-chat-provider-chain';

const product = (id: string) => ({
  id,
  name: id,
  brand: null,
  category: null,
  description: null,
  has_variants: false,
  image_url: null,
  manage_stock: false,
  price: 10,
  slug: null,
  status: 'active',
  stock: null,
});
type Report = (name: string, result: unknown) => void;
let report: Report;
beforeEach(() => {
  vi.resetAllMocks();
  resetProviderCooldowns();
  mocks.chain.mockReturnValue(
    ['google:first', 'google:second', 'cerebras:last'].map((name) => ({
      name,
      model: { id: name } as unknown as TextProvider['model'],
    }))
  );
  mocks.createTools.mockImplementation(
    (_id: string, options: { onToolResult: Report }) => {
      report = options.onToolResult;
      return {};
    }
  );
});

it.each([
  false,
  true,
])('recovers the latest nonempty failed attempt when the next attempt has cards: %s', async (secondHasCards) => {
  let firstReport: Report;
  mocks.generateText.mockImplementation(
    async ({ model }: { model: { id: string } }) => {
      if (model.id === 'google:first') {
        firstReport = report;
        report('getProductDetails', product('first'));
        return { text: '' };
      }
      if (model.id === 'google:second') {
        if (secondHasCards) report('getProductDetails', product('second'));
        firstReport('getProductDetails', product('late-first'));
        throw new Error('second failed');
      }
      return { text: 'I cannot check inventory.' };
    }
  );
  const result = await runChatProviderChain({
    abortSignal: new AbortController().signal,
    messages: [{ role: 'user', content: 'Show phones' }],
    sessionId: 'session',
  });
  expect(
    result.events?.flatMap((event) => event.products.map(({ id }) => id))
  ).toEqual([secondHasCards ? 'second' : 'first']);
  expect(result.providerName).toBe(
    secondHasCards ? 'google:second' : 'google:first'
  );
  expect(result.text).not.toContain('cannot check inventory');
  expect(mocks.generateText).toHaveBeenCalledTimes(2);
});
