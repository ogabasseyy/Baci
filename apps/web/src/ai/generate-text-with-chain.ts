import {
  generateText,
  type ModelMessage,
  type StopCondition,
  type ToolSet,
} from 'ai';
import {
  clearProviderCooldown,
  recordProviderFailure,
} from './provider-cooldown';
import { selectAttemptableProviders } from './select-attemptable-providers';
import {
  type ChainProviderOptions,
  getTextProviderChain,
  type TextProvider,
} from './text-provider-chain';

// Generic chain executor for free-text generation (with optional native tool
// calling). Walks the platform text-provider chain and returns the first
// non-empty completion. ANY failure — 429/quota, 5xx, network, per-provider
// timeout, empty completion, or a caller-rejected result — falls through to
// the next provider: the chain itself is the retry, spread across independent
// infrastructures, so no per-provider backoff is spent (maxRetries: 0, the
// same decision as the builder chain in run-builder-provider-chain.ts).
// Opportunistic providers (contended free pools) are skipped — they are only
// worth consulting under the builder route's explicit deadline budgeting.

export const ALL_TEXT_PROVIDERS_FAILED_ERROR_NAME =
  'AllTextProvidersFailedError';

/** Thrown when `shouldStopWalk` halts the chain after a failed attempt. */
export const CHAIN_WALK_STOPPED_ERROR_NAME = 'ChainWalkStoppedError';

const DEFAULT_PER_PROVIDER_TIMEOUT_MS = 25_000;

// Gemini 2.5 Flash "thinks" by default, which multiplies latency (measured
// 25s vs 3-4s on the real copilot task). Every current chain surface is
// latency-sensitive, so thinking defaults OFF; other providers ignore the
// Google-namespaced option. Callers can override via providerOptions.
const DEFAULT_PROVIDER_OPTIONS: ChainProviderOptions = {
  google: { thinkingConfig: { thinkingBudget: 0 } },
};

export interface GenerateTextWithChainOptions {
  /** Defaults to the platform text chain; pass the vision chain for image input. */
  chain?: TextProvider[];
  system?: string;
  prompt?: string;
  messages?: ModelMessage[];
  tools?: ToolSet;
  /** Creates isolated tool callbacks for each provider attempt. */
  createToolsForAttempt?: (providerName: string) => ToolSet;
  stopWhen?: StopCondition<ToolSet> | StopCondition<ToolSet>[];
  temperature?: number;
  maxOutputTokens?: number;
  /** Per-provider attempt budget; the walk moves on when it elapses. */
  perProviderTimeoutMs?: number;
  /**
   * Total wall-clock budget for the ENTIRE walk. Each attempt is capped to the
   * time left, and the walk stops (throwing exhaustion) once it elapses instead
   * of starting another provider. Pass this on routes with a `maxDuration` so a
   * slow provider can't consume the whole route deadline and starve the
   * caller's own fallback/degradation path (per-provider timeout × N providers
   * can otherwise exceed maxDuration). Omit for no overall cap.
   */
  overallTimeoutMs?: number;
  /** Caller/request signal — when it aborts, the walk stops immediately. */
  abortSignal?: AbortSignal;
  providerOptions?: ChainProviderOptions;
  /**
   * Gate a syntactically-successful completion (e.g. required fields absent
   * from OCR output). Returning false counts the attempt as failed and falls
   * through to the next provider.
   */
  acceptResult?: (text: string) => boolean;
  onProviderAttempt?: (providerName: string) => void;
  onProviderError?: (
    providerName: string,
    error: unknown,
    isLastProvider: boolean
  ) => void;
  /**
   * Consulted after a provider attempt fails. Returning true halts the walk
   * with a CHAIN_WALK_STOPPED_ERROR_NAME error instead of falling through —
   * e.g. when the failed attempt already executed a side-effecting commerce
   * tool and re-running it on another provider would double the side effect.
   */
  shouldStopWalk?: (providerName: string, error: unknown) => boolean;
}

export interface ChainTextResult {
  text: string;
  /** Which provider served the completion, e.g. "cerebras:gemma-4-31b". */
  providerName: string;
}

function buildAttemptSignal(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return callerSignal
    ? AbortSignal.any([callerSignal, timeoutSignal])
    : timeoutSignal;
}

function buildExhaustionError(failures: string[]): Error {
  const error = new Error(`all text providers failed: ${failures.join(' | ')}`);
  error.name = ALL_TEXT_PROVIDERS_FAILED_ERROR_NAME;
  return error;
}

export async function generateTextWithChain(
  options: GenerateTextWithChainOptions
): Promise<ChainTextResult> {
  const chain = selectAttemptableProviders(
    options.chain ?? getTextProviderChain()
  );
  if (chain.length === 0) {
    throw buildExhaustionError(['no providers configured']);
  }

  const timeoutMs =
    options.perProviderTimeoutMs ?? DEFAULT_PER_PROVIDER_TIMEOUT_MS;
  const overallDeadline =
    options.overallTimeoutMs != null
      ? Date.now() + options.overallTimeoutMs
      : null;
  const failures: string[] = [];

  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i];
    const isLastProvider = i === chain.length - 1;

    // The request is gone — stop burning providers on a doomed walk.
    if (options.abortSignal?.aborted) {
      throw buildExhaustionError([...failures, 'request aborted']);
    }

    // Stop before starting a provider we don't have time to finish, so the
    // caller's fallback runs inside the route deadline instead of the whole
    // route timing out mid-attempt.
    const remainingMs = overallDeadline ? overallDeadline - Date.now() : null;
    if (remainingMs != null && remainingMs <= 0) {
      throw buildExhaustionError([...failures, 'overall deadline exceeded']);
    }
    const attemptTimeoutMs =
      remainingMs != null ? Math.min(timeoutMs, remainingMs) : timeoutMs;

    options.onProviderAttempt?.(provider.name);
    try {
      const tools = options.createToolsForAttempt
        ? options.createToolsForAttempt(provider.name)
        : options.tools;
      const result = await generateText({
        model: provider.model,
        system: options.system,
        // generateText accepts exactly one of prompt/messages; the caller's
        // choice is passed through as-is.
        ...(options.messages
          ? { messages: options.messages }
          : { prompt: options.prompt ?? '' }),
        ...(tools ? { tools } : {}),
        ...(options.stopWhen ? { stopWhen: options.stopWhen } : {}),
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
        abortSignal: buildAttemptSignal(options.abortSignal, attemptTimeoutMs),
        maxRetries: 0,
        providerOptions: options.providerOptions ?? DEFAULT_PROVIDER_OPTIONS,
      });

      const text = result.text.trim();
      if (!text) {
        throw new Error('provider returned an empty completion');
      }
      if (options.acceptResult && !options.acceptResult(text)) {
        throw new Error('completion rejected by acceptResult gate');
      }
      clearProviderCooldown(provider.name);
      return { text, providerName: provider.name };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${provider.name}: ${message.slice(0, 200)}`);
      recordProviderFailure(provider.name, error);
      options.onProviderError?.(provider.name, error, isLastProvider);
      if (options.shouldStopWalk?.(provider.name, error)) {
        const stopError = new Error(
          `provider chain walk stopped after ${provider.name} failed: ${message.slice(0, 200)}`
        );
        stopError.name = CHAIN_WALK_STOPPED_ERROR_NAME;
        throw stopError;
      }
    }
  }

  throw buildExhaustionError(failures);
}
