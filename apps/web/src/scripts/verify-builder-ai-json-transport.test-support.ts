import { vi } from 'vitest';

export interface SmokeProvider {
  model: object;
  name: string;
  opportunistic?: boolean;
}

export interface SmokeDependencies {
  combineSignals: (signals: AbortSignal[]) => AbortSignal;
  createDeadlineSignal: (milliseconds: number) => AbortSignal;
  environment: Record<string, string | undefined>;
  materializeProviders: (signal: AbortSignal) => Promise<SmokeProvider[]>;
  loadEnvironment: (options: {
    override: boolean;
    path: string;
    quiet: boolean;
  }) => { error?: Error };
  now: () => number;
  runProvider: (provider: SmokeProvider, signal: AbortSignal) => Promise<boolean>;
  validateEnvironmentSource: (
    source: string | undefined
  ) => Promise<{ path: string } | null>;
  write: (line: string) => void;
}

export interface SmokeModule {
  verifyBuilderAiJsonTransport: (
    dependencies: SmokeDependencies
  ) => Promise<number>;
}

const smokeModulePath = './verify-builder-ai-json-transport';

export function loadSmokeModule(): Promise<SmokeModule> {
  return import(smokeModulePath) as Promise<SmokeModule>;
}

export function createDependencies(
  environment: Record<string, string | undefined> = {}
): SmokeDependencies {
  return {
    combineSignals: vi.fn((signals) => signals[0] as AbortSignal),
    createDeadlineSignal: vi.fn(() => new AbortController().signal),
    environment: {
      BACI_APPROVE_PAID_AI_SMOKE: '1',
      BACI_WEB_ENV_SOURCE: '/primary/apps/web/.env',
      GOOGLE_GENAI_API_KEY: 'google-test',
      GROQ_API_KEY: 'groq-test',
      OPENROUTER_API_KEY: 'openrouter-test',
      ...environment,
    },
    materializeProviders: vi.fn(async () => [
      {
        model: { id: 'google' },
        name: 'google:gemma-4-31b-it',
      },
      {
        model: { id: 'groq' },
        name: 'groq:openai/gpt-oss-120b',
      },
      {
        model: { id: 'openrouter' },
        name: 'openrouter:google/gemma-4-31b-it:free',
        opportunistic: true,
      },
    ]),
    loadEnvironment: vi.fn(() => ({})),
    now: vi.fn(() => 1_000),
    runProvider: vi.fn(async () => true),
    validateEnvironmentSource: vi.fn(async (source) =>
      source?.startsWith('/primary/apps/web/') ? { path: source } : null
    ),
    write: vi.fn(),
  };
}

export const REFUSAL_RECORD = 'provider=none model=none result=refused latencyMs=0';
