import { describe, expect, it, vi } from 'vitest';
import {
  createDependencies,
  loadSmokeModule,
  REFUSAL_RECORD,
} from './verify-builder-ai-json-transport.test-support';

describe('verifyBuilderAiJsonTransport refusal contract', () => {
  it.each([
    ['without approval', { BACI_APPROVE_PAID_AI_SMOKE: undefined }],
    ['with an invalid source', { BACI_WEB_ENV_SOURCE: '/outside/.env' }],
  ])('refuses %s before catalog materialization', async (_name, environment) => {
    const dependencies = createDependencies(environment);
    const { verifyBuilderAiJsonTransport } = await loadSmokeModule();

    await expect(verifyBuilderAiJsonTransport(dependencies)).resolves.toBe(1);
    expect(dependencies.materializeProviders).not.toHaveBeenCalled();
    expect(dependencies.write).toHaveBeenCalledWith(REFUSAL_RECORD);
  });

  it('refuses a zero-provider catalog without a fallback', async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.materializeProviders).mockResolvedValue([]);
    const { verifyBuilderAiJsonTransport } = await loadSmokeModule();

    await expect(verifyBuilderAiJsonTransport(dependencies)).resolves.toBe(1);
    expect(dependencies.runProvider).not.toHaveBeenCalled();
  });

  it('loads the approved environment over inherited credentials', async () => {
    const dependencies = createDependencies();
    delete dependencies.runWorkerCommand;
    const { verifyBuilderAiJsonTransport } = await loadSmokeModule();

    await expect(verifyBuilderAiJsonTransport(dependencies)).resolves.toBe(0);
    expect(dependencies.loadEnvironment).toHaveBeenCalledWith({
      override: true,
      path: '/primary/apps/web/.env',
      quiet: true,
    });
  });
});
