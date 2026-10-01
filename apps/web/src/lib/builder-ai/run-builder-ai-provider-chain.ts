import {
  type BuilderAiEditPlan,
  type BuilderData,
  builderAiEditContract,
} from '@baci/shared/contracts';
import { generateText, NoObjectGeneratedError, Output } from 'ai';
import { builderAiPlanOutputBudget } from './builder-ai-plan-output-budget';
import type { BuilderAiProvider } from './builder-ai-provider-catalog';
import { builderAiProviderCooldown } from './builder-ai-provider-cooldown';
import { getBuilderAiRawPlanMediaWarning } from './get-builder-ai-raw-plan-media-warning';
import { hasCanonicalBuilderAiProviderOrder } from './has-canonical-builder-ai-provider-order';
import { normalizeBuilderAiModelPlan } from './normalize-builder-ai-model-plan';

const RESPONSE_MARGIN_MS = builderAiPlanOutputBudget.routeResponseMarginMs;
const RELIABLE_PROVIDER_TAIL_RESERVE_MS = 8_000;

export interface BuilderAiProviderCooldown {
  isCoolingDown: (providerName: string) => boolean;
  recordFailure?: (providerName: string, error: unknown) => void;
}

export interface RunBuilderAiProviderChainOptions {
  cooldown?: BuilderAiProviderCooldown;
  currentConfig: BuilderData;
  deadlineAt: number;
  logger?: { warn: (metadata: Record<string, unknown>) => void };
  now?: () => number;
  prompt: string;
  providerChain: BuilderAiProvider[];
  signal: AbortSignal;
  validateSemantics?: (
    plan: BuilderAiEditPlan,
    currentConfig: BuilderData
  ) => boolean;
}

function unavailable(): { code: 'ai_provider_unavailable' } {
  return { code: 'ai_provider_unavailable' };
}

function invalidOutput(): { code: 'ai_builder_invalid_output' } {
  return { code: 'ai_builder_invalid_output' };
}

function rateLimited(): { code: 'ai_provider_rate_limited' } {
  return { code: 'ai_provider_rate_limited' };
}

function isInvalidOutputFailure(error: unknown): boolean {
  return NoObjectGeneratedError.isInstance(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasPlacementEnvelope(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    value.position === 'first_content' ||
    (value.position === 'after' && hasNonEmptyString(value.componentId))
  );
}

function hasOperationEnvelope(operation: unknown): boolean {
  if (!isRecord(operation)) return false;
  switch (operation.kind) {
    case 'insert_component':
      return (
        isRecord(operation.initialContent) &&
        hasNonEmptyString(operation.initialContent.componentType) &&
        hasPlacementEnvelope(operation.placement)
      );
    case 'move_component':
      return (
        hasNonEmptyString(operation.componentId) &&
        hasPlacementEnvelope(operation.destination)
      );
    case 'remove_component':
      return hasNonEmptyString(operation.componentId);
    case 'update_carousel_slide':
      return (
        hasNonEmptyString(operation.componentId) &&
        Number.isInteger(operation.slideIndex)
      );
    case 'update_component':
      return (
        hasNonEmptyString(operation.componentId) &&
        isRecord(operation.patch) &&
        hasNonEmptyString(operation.patch.componentType)
      );
    case 'update_root':
      return hasNonEmptyString(operation.title);
    case 'update_theme':
      return hasNonEmptyString(operation.preset) || isRecord(operation.colors);
    default:
      return false;
  }
}

function hasProposedPlanEnvelope(output: unknown): boolean {
  if (!isRecord(output)) return false;
  return (
    output.status === 'proposed' &&
    typeof output.summary === 'string' &&
    output.summary.trim().length > 0 &&
    output.summary.trim().length <= 240 &&
    Array.isArray(output.operations) &&
    output.operations.every(hasOperationEnvelope)
  );
}

function logSafeFailure(
  logger: RunBuilderAiProviderChainOptions['logger'],
  provider: BuilderAiProvider,
  error: unknown
): void {
  logger?.warn({
    errorClass:
      error instanceof Error ? error.name.slice(0, 80) : 'UnknownProviderError',
    event: 'builder_ai_provider_fallback',
    provider: provider.name,
  });
}

function attemptSignal(
  source: AbortSignal,
  remainingMs: number,
  reservedTailMs: number
): AbortSignal {
  return AbortSignal.any([
    source,
    AbortSignal.timeout(
      Math.max(1, remainingMs - RESPONSE_MARGIN_MS - reservedTailMs)
    ),
  ]);
}

function reliableProviderTailMs(
  providerChain: BuilderAiProvider[],
  currentIndex: number
): number {
  const remainingReliableProviders = providerChain
    .slice(currentIndex + 1)
    .filter((provider) => !provider.opportunistic).length;
  return remainingReliableProviders > 0 ? RELIABLE_PROVIDER_TAIL_RESERVE_MS : 0;
}

async function requestPlan(
  provider: BuilderAiProvider,
  prompt: string,
  signal: AbortSignal
): Promise<unknown> {
  const result = await generateText({
    abortSignal: signal,
    maxOutputTokens: builderAiPlanOutputBudget.maxOutputTokens,
    maxRetries: 0,
    model: provider.model,
    output: Output.json(),
    prompt,
  });
  return result.output;
}

export async function runBuilderAiProviderChain({
  cooldown = builderAiProviderCooldown,
  currentConfig,
  deadlineAt,
  logger,
  now = Date.now,
  prompt,
  providerChain,
  signal,
  validateSemantics = () => true,
}: RunBuilderAiProviderChainOptions): Promise<BuilderAiEditPlan> {
  if (
    signal.aborted ||
    !hasCanonicalBuilderAiProviderOrder(providerChain) ||
    deadlineAt - now() <= RESPONSE_MARGIN_MS
  ) {
    throw unavailable();
  }

  let sawInvalidOutput = false;
  let sawNonQuotaOperationalFailure = false;
  let sawQuotaFailure = false;
  const availableProviders = providerChain.filter(
    (provider) => !cooldown?.isCoolingDown(provider.name)
  );
  const providersToAttempt =
    availableProviders.length > 0 ? availableProviders : providerChain;
  for (const [providerIndex, provider] of providersToAttempt.entries()) {
    const remainingMs = deadlineAt - now();
    if (remainingMs <= RESPONSE_MARGIN_MS) break;
    const signalForAttempt = attemptSignal(
      signal,
      remainingMs,
      reliableProviderTailMs(providersToAttempt, providerIndex)
    );
    const attempts = provider.opportunistic ? 1 : 2;

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (signal.aborted || signalForAttempt.aborted) break;
      try {
        const output = await requestPlan(provider, prompt, signalForAttempt);
        if (
          getBuilderAiRawPlanMediaWarning(output) &&
          hasProposedPlanEnvelope(output)
        ) {
          return output as BuilderAiEditPlan;
        }
        const parsed = builderAiEditContract.modelPlanSchema.safeParse(
          normalizeBuilderAiModelPlan(output)
        );
        if (!parsed.success || !validateSemantics(parsed.data, currentConfig)) {
          sawInvalidOutput = true;
          logSafeFailure(logger, provider, new Error('BuilderAiInvalidOutput'));
          break;
        }
        return parsed.data;
      } catch (error) {
        const quotaFailure = builderAiProviderCooldown.isRateLimitError(error);
        const invalidOutputFailure = isInvalidOutputFailure(error);
        sawQuotaFailure ||= quotaFailure;
        sawInvalidOutput ||= invalidOutputFailure;
        sawNonQuotaOperationalFailure ||=
          !quotaFailure && !invalidOutputFailure;
        cooldown?.recordFailure?.(provider.name, error);
        logSafeFailure(logger, provider, error);
        // Malformed SDK JSON is a model-output failure: fall through rather
        // than burning a duplicate request to the same model.
        if (invalidOutputFailure || quotaFailure) break;
        if (signalForAttempt.aborted || signal.aborted) break;
      }
    }
  }
  // A provider outage remains more actionable than a capacity signal: mixed
  // quota/outage exhaustion is retryable service unavailability (503). A 429
  // is emitted only when every operational failure was capacity-related.
  if (sawNonQuotaOperationalFailure) throw unavailable();
  if (sawQuotaFailure) throw rateLimited();
  if (sawInvalidOutput) throw invalidOutput();
  throw unavailable();
}
