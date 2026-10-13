import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDependencies,
  loadSmokeModule,
} from './verify-builder-ai-json-transport.test-support';

interface DefaultSmokeModule {
  createDefaultBuilderAiJsonTransportSmokeDependencies: () => {
    environment: Record<string, string | undefined>;
    loadEnvironment: () => { error?: Error };
    materializeProviders: (signal: AbortSignal) => Promise<never[]>;
    runWorkerCommand?: (command: { kind: string }) => Promise<unknown>;
    validateEnvironmentSource: () => Promise<{ path: string } | null>;
    write: (line: string) => void;
  };
  verifyBuilderAiJsonTransport: (dependencies: {
    environment: Record<string, string | undefined>;
    loadEnvironment: () => { error?: Error };
    materializeProviders: (signal: AbortSignal) => Promise<never[]>;
    write: (line: string) => void;
  }) => Promise<number>;
}

describe('verifyBuilderAiJsonTransport deadlines', () => {
  afterEach(() => vi.useRealTimers());

  function createTimedSignal(milliseconds: number): AbortSignal {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), milliseconds);
    return controller.signal;
  }

  it('uses the default CLI worker seam without loading provider credentials in-process', async () => {
    const module = (await loadSmokeModule()) as unknown as DefaultSmokeModule;
    const dependencies =
      module.createDefaultBuilderAiJsonTransportSmokeDependencies();
    dependencies.environment = {
      BACI_APPROVE_PAID_AI_SMOKE: '1',
      BACI_WEB_ENV_SOURCE: '/primary/apps/web/.env',
    };
    dependencies.loadEnvironment = vi.fn(() => ({}));
    dependencies.materializeProviders = vi.fn(async () => []);
    dependencies.validateEnvironmentSource = vi.fn(async () => ({
      path: '/primary/apps/web/.env',
    }));
    dependencies.runWorkerCommand = vi.fn(async (command) =>
      command.kind === 'list'
        ? {
            kind: 'providers',
            providers: [
              { name: 'google:gemma-4-31b-it' },
              { name: 'groq:openai/gpt-oss-120b' },
            ],
          }
        : { kind: 'probe', passed: true }
    );
    dependencies.write = vi.fn();

    await expect(module.verifyBuilderAiJsonTransport(dependencies)).resolves.toBe(0);

    expect(dependencies.loadEnvironment).not.toHaveBeenCalled();
    expect(dependencies.materializeProviders).not.toHaveBeenCalled();
    expect(dependencies.runWorkerCommand).toHaveBeenCalledTimes(3);
  });

  it('bounds provider materialization and each configured probe by the whole-smoke deadline', async () => {
    const dependencies = createDependencies();
    const wholeSmoke = new AbortController();
    const google = new AbortController();
    const groq = new AbortController();
    const openRouter = new AbortController();
    vi.mocked(dependencies.createDeadlineSignal)
      .mockReturnValueOnce(wholeSmoke.signal)
      .mockReturnValueOnce(google.signal)
      .mockReturnValueOnce(groq.signal)
      .mockReturnValueOnce(openRouter.signal);
    vi.mocked(dependencies.combineSignals)
      .mockReturnValueOnce(google.signal)
      .mockReturnValueOnce(groq.signal)
      .mockReturnValueOnce(openRouter.signal);
    const { verifyBuilderAiJsonTransport } = await loadSmokeModule();

    await expect(verifyBuilderAiJsonTransport(dependencies)).resolves.toBe(0);

    expect(dependencies.materializeProviders).toHaveBeenCalledWith(
      wholeSmoke.signal
    );
    expect(dependencies.combineSignals).toHaveBeenNthCalledWith(1, [
      wholeSmoke.signal,
      google.signal,
    ]);
    expect(dependencies.combineSignals).toHaveBeenNthCalledWith(2, [
      wholeSmoke.signal,
      groq.signal,
    ]);
    expect(dependencies.combineSignals).toHaveBeenNthCalledWith(3, [
      wholeSmoke.signal,
      openRouter.signal,
    ]);
    expect(vi.mocked(dependencies.runProvider).mock.calls.map(([, signal]) => signal)).toEqual([
      google.signal,
      groq.signal,
      openRouter.signal,
    ]);
  });

  it('stops provider probes when the whole-smoke deadline expires', async () => {
    const dependencies = createDependencies();
    const wholeSmoke = new AbortController();
    vi.mocked(dependencies.createDeadlineSignal).mockReturnValue(wholeSmoke.signal);
    vi.mocked(dependencies.combineSignals).mockReturnValue(wholeSmoke.signal);
    vi.mocked(dependencies.runProvider).mockImplementation(async () => {
      wholeSmoke.abort();
      return false;
    });
    const { verifyBuilderAiJsonTransport } = await loadSmokeModule();

    await expect(verifyBuilderAiJsonTransport(dependencies)).resolves.toBe(1);

    expect(dependencies.runProvider).toHaveBeenCalledOnce();
  });

  it('returns a bounded refusal when catalog materialization ignores an aborted whole-smoke signal', async () => {
    vi.useFakeTimers();
    const dependencies = createDependencies();
    vi.mocked(dependencies.createDeadlineSignal).mockImplementation(
      createTimedSignal
    );
    vi.mocked(dependencies.materializeProviders).mockReturnValue(
      new Promise(() => {})
    );
    const { verifyBuilderAiJsonTransport } = await loadSmokeModule();

    const completion = verifyBuilderAiJsonTransport(dependencies);

    await vi.advanceTimersByTimeAsync(30_000);

    await expect(completion).resolves.toBe(1);
  });

  it('allows a healthy Google probe to complete after the legacy five-second deadline', async () => {
    vi.useFakeTimers();
    const dependencies = createDependencies();
    vi.mocked(dependencies.createDeadlineSignal).mockImplementation(
      createTimedSignal
    );
    vi.mocked(dependencies.combineSignals).mockImplementation((signals) =>
      AbortSignal.any(signals)
    );
    vi.mocked(dependencies.runProvider)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          setTimeout(() => resolve(true), 8_000);
        })
      )
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    const { verifyBuilderAiJsonTransport } = await loadSmokeModule();

    const completion = verifyBuilderAiJsonTransport(dependencies);
    await vi.advanceTimersByTimeAsync(8_000);

    await expect(completion).resolves.toBe(0);
    expect(
      vi.mocked(dependencies.runProvider).mock.calls.map(
        ([provider]) => provider.name
      )
    ).toEqual([
      'google:gemma-4-31b-it',
      'groq:openai/gpt-oss-120b',
      'openrouter:google/gemma-4-31b-it:free',
    ]);
  });
});
