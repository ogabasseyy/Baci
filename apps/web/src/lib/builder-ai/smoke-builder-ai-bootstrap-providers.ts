import type { BuilderAiProvider } from './builder-ai-provider-catalog';
import { runBuilderAiJsonTransportSmoke } from './run-builder-ai-json-transport-smoke';

const PROVIDER_DEADLINE_MS = 5_000;
const GOOGLE_PROVIDER_DEADLINE_MS = 15_000;
const WHOLE_DEADLINE_MS = 30_000;

function providerDeadlineMs(provider: BuilderAiProvider): number {
  return provider.name.startsWith('google:')
    ? GOOGLE_PROVIDER_DEADLINE_MS
    : PROVIDER_DEADLINE_MS;
}

export interface BuilderAiBootstrapSmokeResult {
  latencyMs: number;
  provider: string;
  result: 'fail' | 'pass';
}

/** Runs the canonical provider list in order with non-extendable budgets. */
export async function smokeBuilderAiBootstrapProviders(
  providers: BuilderAiProvider[],
  runProvider: typeof runBuilderAiJsonTransportSmoke = runBuilderAiJsonTransportSmoke,
  now = Date.now
): Promise<BuilderAiBootstrapSmokeResult[]> {
  const wholeSignal = AbortSignal.timeout(WHOLE_DEADLINE_MS);
  const results: BuilderAiBootstrapSmokeResult[] = [];
  for (const provider of providers) {
    if (wholeSignal.aborted) {
      results.push({ latencyMs: 0, provider: provider.name, result: 'fail' });
      break;
    }
    const startedAt = now();
    let passed = false;
    try {
      passed = await runProvider(
        provider,
        AbortSignal.any([
          wholeSignal,
          AbortSignal.timeout(providerDeadlineMs(provider)),
        ])
      );
    } catch {
      passed = false;
    }
    results.push({
      latencyMs: Math.max(0, now() - startedAt),
      provider: provider.name,
      result: passed ? 'pass' : 'fail',
    });
    if (!passed) break;
  }
  return results;
}
