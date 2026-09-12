import { afterEach, describe, expect, it, vi } from 'vitest';
import { smokeBuilderAiBootstrapProviders } from './smoke-builder-ai-bootstrap-providers';

const providers = [
  { model: {} as never, name: 'google:gemma-4-31b-it' },
  { model: {} as never, name: 'groq:openai/gpt-oss-120b' },
  {
    model: {} as never,
    name: 'openrouter:google/gemma-4-31b-it:free',
    opportunistic: true,
  },
];

describe('smokeBuilderAiBootstrapProviders', () => {
  afterEach(() => vi.restoreAllMocks());

  it('preserves canonical order with a longer Google provider budget', async () => {
    const timeouts: number[] = [];
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      timeouts.push(milliseconds);
      return new AbortController().signal;
    });
    const runProvider = vi.fn().mockResolvedValue(true);

    await expect(
      smokeBuilderAiBootstrapProviders(providers, runProvider)
    ).resolves.toEqual([
      {
        latencyMs: expect.any(Number),
        provider: providers[0].name,
        result: 'pass',
      },
      {
        latencyMs: expect.any(Number),
        provider: providers[1].name,
        result: 'pass',
      },
      {
        latencyMs: expect.any(Number),
        provider: providers[2].name,
        result: 'pass',
      },
    ]);
    expect(runProvider.mock.calls.map(([provider]) => provider.name)).toEqual(
      providers.map(({ name }) => name)
    );
    expect(timeouts).toEqual([30_000, 15_000, 5_000, 5_000]);
  });

  it('stops before later providers after an invalid smoke output', async () => {
    const runProvider = vi.fn().mockResolvedValue(false);
    await expect(
      smokeBuilderAiBootstrapProviders(providers, runProvider)
    ).resolves.toEqual([
      {
        latencyMs: expect.any(Number),
        provider: providers[0].name,
        result: 'fail',
      },
    ]);
    expect(runProvider).toHaveBeenCalledOnce();
  });

  it('treats a provider exception as a failed smoke and stops the chain', async () => {
    const runProvider = vi
      .fn()
      .mockRejectedValue(new Error('transport failed'));

    await expect(
      smokeBuilderAiBootstrapProviders(providers, runProvider)
    ).resolves.toEqual([
      {
        latencyMs: expect.any(Number),
        provider: providers[0].name,
        result: 'fail',
      },
    ]);
    expect(runProvider).toHaveBeenCalledOnce();
  });

  it('does not invoke a provider when the overall smoke signal is already aborted', async () => {
    const aborted = new AbortController();
    aborted.abort();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(aborted.signal);
    const runProvider = vi.fn();

    await expect(
      smokeBuilderAiBootstrapProviders(providers, runProvider)
    ).resolves.toEqual([
      { latencyMs: 0, provider: providers[0].name, result: 'fail' },
    ]);
    expect(runProvider).not.toHaveBeenCalled();
  });
});
