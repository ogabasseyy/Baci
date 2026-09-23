import { config as loadDotenv } from 'dotenv';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  builderAiJsonTransportContract,
  type BuilderAiJsonTransportProviderDescriptor,
} from './builder-ai-json-transport-contract';
import { settleBuilderAiSmokeBeforeDeadline } from './builder-ai-smoke-deadline';
import { validateBuilderAiSmokeEnvironmentSource } from './builder-ai-smoke-environment-source';
import {
  runBuilderAiSmokeWorkerCommand,
  type BuilderAiSmokeWorkerCommand,
  type BuilderAiSmokeWorkerResult,
} from './builder-ai-smoke-supervisor';

type SmokeProvider = BuilderAiJsonTransportProviderDescriptor & { model: object };
type SmokeResult = 'fail' | 'pass' | 'refused';
type WorkerRunner = (command: BuilderAiSmokeWorkerCommand, deadlineMs: number) => Promise<BuilderAiSmokeWorkerResult>;

const DEFAULT_PROVIDER_SMOKE_DEADLINE_MS = 5_000;
const GOOGLE_PROVIDER_SMOKE_DEADLINE_MS = 15_000;
const WHOLE_SMOKE_DEADLINE_MS = 30_000;

export interface BuilderAiJsonTransportSmokeDependencies {
  combineSignals: (signals: AbortSignal[]) => AbortSignal;
  createDeadlineSignal: (milliseconds: number) => AbortSignal;
  environment: Record<string, string | undefined>;
  materializeProviders: (signal: AbortSignal) => Promise<SmokeProvider[]>;
  loadEnvironment: (options: {
    override: boolean;
    path: string;
    quiet: boolean;
  }) => { error?: unknown };
  now: () => number;
  runProvider: (provider: SmokeProvider, signal: AbortSignal) => Promise<boolean>;
  runWorkerCommand?: WorkerRunner;
  validateEnvironmentSource: (source: string | undefined) => Promise<{ path: string } | null>;
  write: (line: string) => void;
}

function writeResult(
  write: (line: string) => void,
  provider: string,
  model: string,
  result: SmokeResult,
  latencyMs: number
): void {
  write(
    `provider=${provider} model=${model} result=${result} latencyMs=${latencyMs}`
  );
}

function refuse(dependencies: BuilderAiJsonTransportSmokeDependencies): number {
  writeResult(dependencies.write, 'none', 'none', 'refused', 0);
  return 1;
}

function providerSmokeDeadlineMs(providerAlias: string): number {
  return providerAlias === 'google'
    ? GOOGLE_PROVIDER_SMOKE_DEADLINE_MS
    : DEFAULT_PROVIDER_SMOKE_DEADLINE_MS;
}

export function createDefaultBuilderAiJsonTransportSmokeDependencies(): BuilderAiJsonTransportSmokeDependencies {
  return {
    combineSignals: AbortSignal.any,
    createDeadlineSignal: AbortSignal.timeout,
    environment: process.env,
    materializeProviders: async () => [],
    loadEnvironment: loadDotenv,
    now: Date.now,
    runProvider: async () => false,
    runWorkerCommand: (command, deadlineMs) =>
      runBuilderAiSmokeWorkerCommand(command, {
        deadlineMs,
        workerPath: fileURLToPath(
          new URL('./builder-ai-json-transport-worker.ts', import.meta.url)
        ),
      }),
    validateEnvironmentSource: validateBuilderAiSmokeEnvironmentSource,
    write: console.log,
  };
}

export async function verifyBuilderAiJsonTransport(
  dependencies: BuilderAiJsonTransportSmokeDependencies = createDefaultBuilderAiJsonTransportSmokeDependencies()
): Promise<number> {
  const source = await dependencies.validateEnvironmentSource(
    dependencies.environment.BACI_WEB_ENV_SOURCE
  );
  if (
    dependencies.environment.BACI_APPROVE_PAID_AI_SMOKE !== '1' ||
    !source
  ) {
    return refuse(dependencies);
  }

  if (dependencies.runWorkerCommand) {
    return verifyWithCredentialWorker(dependencies, source.path);
  }

  try {
    const loaded = dependencies.loadEnvironment({
      override: true,
      path: source.path,
      quiet: true,
    });
    if (loaded.error) {
      return refuse(dependencies);
    }
  } catch {
    return refuse(dependencies);
  }
  const wholeSmokeSignal = dependencies.createDeadlineSignal(
    WHOLE_SMOKE_DEADLINE_MS
  );
  if (wholeSmokeSignal.aborted) return refuse(dependencies);

  let providers: SmokeProvider[];
  try {
    providers = await settleBuilderAiSmokeBeforeDeadline(
      dependencies.materializeProviders(wholeSmokeSignal),
      wholeSmokeSignal,
      WHOLE_SMOKE_DEADLINE_MS
    );
  } catch {
    return refuse(dependencies);
  }
  if (
    wholeSmokeSignal.aborted ||
    !builderAiJsonTransportContract.hasCanonicalProviderOrder(providers)
  ) {
    return refuse(dependencies);
  }

  let requiredProviderFailed = false;
  for (const provider of providers) {
    if (wholeSmokeSignal.aborted) {
      requiredProviderFailed = true;
      break;
    }
    const identity = builderAiJsonTransportContract.getProviderIdentity(
      provider.name
    );
    const providerDeadlineMs = providerSmokeDeadlineMs(identity.alias);
    const startedAt = dependencies.now();
    const signal = dependencies.combineSignals([
      wholeSmokeSignal,
      dependencies.createDeadlineSignal(providerDeadlineMs),
    ]);
    let passed = false;
    try {
      passed = await settleBuilderAiSmokeBeforeDeadline(
        dependencies.runProvider(provider, signal),
        signal,
        providerDeadlineMs
      );
    } catch {
      passed = false;
    }
    writeResult(
      dependencies.write,
      identity.alias,
      identity.model,
      passed ? 'pass' : 'fail',
      Math.max(0, dependencies.now() - startedAt)
    );
    if ((!passed && !provider.opportunistic) || wholeSmokeSignal.aborted) {
      requiredProviderFailed = true;
    }
    if (wholeSmokeSignal.aborted) break;
  }

  return requiredProviderFailed ? 1 : 0;
}

async function verifyWithCredentialWorker(
  dependencies: BuilderAiJsonTransportSmokeDependencies,
  sourcePath: string
): Promise<number> {
  const startedAt = dependencies.now();
  const remaining = () =>
    Math.max(0, WHOLE_SMOKE_DEADLINE_MS - (dependencies.now() - startedAt));
  const list = await dependencies.runWorkerCommand?.(
    { kind: 'list', sourcePath },
    remaining()
  );
  if (
    !list ||
    list.kind !== 'providers' ||
    !builderAiJsonTransportContract.hasCanonicalProviderOrder(list.providers)
  ) {
    return refuse(dependencies);
  }

  let requiredProviderFailed = false;
  for (const provider of list.providers) {
    const identity = builderAiJsonTransportContract.getProviderIdentity(
      provider.name
    );
    const deadlineMs = Math.min(
      providerSmokeDeadlineMs(identity.alias),
      remaining()
    );
    if (deadlineMs <= 0) {
      requiredProviderFailed = true;
      break;
    }
    const providerStartedAt = dependencies.now();
    const result = await dependencies.runWorkerCommand?.(
      { deadlineMs, kind: 'probe', providerName: provider.name, sourcePath },
      deadlineMs
    );
    const passed = result?.kind === 'probe' && result.passed;
    writeResult(
      dependencies.write,
      identity.alias,
      identity.model,
      passed ? 'pass' : 'fail',
      Math.max(0, dependencies.now() - providerStartedAt)
    );
    if ((!passed && !provider.opportunistic) || remaining() <= 0) {
      requiredProviderFailed = true;
    }
    if (remaining() <= 0) break;
  }
  return requiredProviderFailed ? 1 : 0;
}

const entrypoint = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;

if (entrypoint === import.meta.url) {
  verifyBuilderAiJsonTransport().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
