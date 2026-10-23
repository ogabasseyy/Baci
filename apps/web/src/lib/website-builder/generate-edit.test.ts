import { expect, it, vi } from 'vitest';
import { createPrivateHome } from './create-private-home';
import { generateStorefrontEdit } from './generate-edit';

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  run: vi.fn(),
  providers: ['fixture'],
}));
vi.mock('@/lib/builder-ai/materialize-builder-ai-provider-chain', () => ({
  materializeBuilderAiProviderChain: () => ({ providers: mocks.providers }),
}));
vi.mock('@/lib/builder-ai/prepare-builder-ai-edit-prompt', () => ({
  prepareBuilderAiEditPrompt: mocks.prepare,
}));
vi.mock('@/lib/builder-ai/run-builder-ai-provider-chain', () => ({
  runBuilderAiProviderChain: mocks.run,
}));
it('rejects an oversized edit before invoking a model', () => {
  mocks.prepare.mockReturnValue({ ok: false });
  expect(() =>
    generateStorefrontEdit({
      source: createPrivateHome('Store'),
      instructions: 'change',
      signal: AbortSignal.timeout(1000),
    })
  ).toThrow('too large');
  expect(mocks.run).not.toHaveBeenCalled();
});
it('passes bounded provider authority and rejects invalid semantic candidates', async () => {
  mocks.prepare.mockReturnValue({ ok: true, prompt: 'bounded' });
  mocks.run.mockResolvedValue({ status: 'failed' });
  const signal = AbortSignal.timeout(1000);
  await generateStorefrontEdit({
    source: createPrivateHome('Store'),
    instructions: 'change',
    signal,
  });
  const args = mocks.run.mock.calls[0][0];
  expect(args.signal).toBe(signal);
  expect(args.providerChain).toEqual(mocks.providers);
  expect(args.prompt).toContain('Header and Footer are protected');
  expect(args.validateSemantics({ operations: [{ kind: 'unsafe' }] })).toBe(
    false
  );
});
