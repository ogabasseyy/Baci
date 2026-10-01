import { config as loadDotenv } from 'dotenv';
import { builderAiPlanOutputBudget } from '@/lib/builder-ai/builder-ai-plan-output-budget';
import { materializeBuilderAiProviderChain } from '@/lib/builder-ai/materialize-builder-ai-provider-chain';
import {
  BUILDER_AI_JSON_SMOKE_PROMPT,
  isValidBuilderAiJsonTransportSmokeResult,
  runBuilderAiJsonTransportSmoke,
} from '@/lib/builder-ai/run-builder-ai-json-transport-smoke';
import { validateBuilderAiSmokeEnvironmentSource } from './builder-ai-smoke-environment-source';
import { clearBuilderAiSmokeProviderEnvironment } from './clear-builder-ai-smoke-provider-environment';

export {
  BUILDER_AI_JSON_SMOKE_PROMPT,
  isValidBuilderAiJsonTransportSmokeResult,
};

interface WorkerCommand {
  deadlineMs?: number;
  kind: 'list' | 'probe';
  providerName?: string;
  sourcePath: string;
}

export async function runProviderSmoke(
  provider: Parameters<typeof runBuilderAiJsonTransportSmoke>[0],
  signal: AbortSignal
): Promise<boolean> {
  return runBuilderAiJsonTransportSmoke(provider, signal);
}

async function loadProviders(sourcePath: string) {
  const source = await validateBuilderAiSmokeEnvironmentSource(sourcePath);
  if (!source) return null;
  clearBuilderAiSmokeProviderEnvironment();
  const loaded = loadDotenv({ override: true, path: source.path, quiet: true });
  if (loaded.error) return null;
  return materializeBuilderAiProviderChain(undefined, undefined, 'smoke').providers;
}

async function handle(command: WorkerCommand): Promise<void> {
  const providers = await loadProviders(command.sourcePath);
  if (!providers) {
    process.send?.({ kind: 'error' });
    return;
  }
  if (command.kind === 'list') {
    process.send?.({
      kind: 'providers',
      providers: providers.map(({ name, opportunistic }) => ({
        name,
        opportunistic,
      })),
    });
    return;
  }
  const provider = providers.find(({ name }) => name === command.providerName);
  if (!provider || !builderAiPlanOutputBudget.isApproved(builderAiPlanOutputBudget.maxOutputTokens)) {
    process.send?.({ kind: 'probe', passed: false });
    return;
  }
  try {
    const passed = await runProviderSmoke(
      provider,
      AbortSignal.timeout(command.deadlineMs ?? 5_000)
    );
    process.send?.({ kind: 'probe', passed });
  } catch {
    process.send?.({ kind: 'probe', passed: false });
  }
}

if (typeof process.send === 'function') {
  process.on('message', (command: WorkerCommand) => {
    void handle(command).catch(() => process.send?.({ kind: 'error' }));
  });
}
