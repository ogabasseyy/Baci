import { describe, expect, it, vi } from 'vitest';
import { createDependencies, loadSmokeModule } from './verify-builder-ai-json-transport.test-support';

describe('verifyBuilderAiJsonTransport provider accounting', () => {
  it('refuses smoke when either required reliable provider is absent', async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.materializeProviders).mockResolvedValue([
      { model: {}, name: 'groq:openai/gpt-oss-120b' },
    ]);
    const { verifyBuilderAiJsonTransport } = await loadSmokeModule();

    await expect(verifyBuilderAiJsonTransport(dependencies)).resolves.toBe(1);
    expect(dependencies.runProvider).not.toHaveBeenCalled();
  });

  it('refuses a direct Google or unpinned OpenRouter adapter before probing', async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.materializeProviders).mockResolvedValue([
      { model: {}, name: 'google:gemini-2.5-flash' },
    ]);
    const { verifyBuilderAiJsonTransport } = await loadSmokeModule();

    await expect(verifyBuilderAiJsonTransport(dependencies)).resolves.toBe(1);
    expect(dependencies.runProvider).not.toHaveBeenCalled();
  });
});
