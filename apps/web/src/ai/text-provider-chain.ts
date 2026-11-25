import { createCerebras } from '@ai-sdk/cerebras';
import { createGroq } from '@ai-sdk/groq';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { JSONValue, LanguageModel } from 'ai';
import {
  ACTIVE_TEXT_MODEL_NAME,
  activeTextModel,
  FALLBACK_TEXT_MODEL_NAME,
  fallbackTextModel,
} from './provider';

// Platform-wide text-provider chain — the generalization of the AI-copilot
// chain shipped for the builder (PR #2978), now shared by every text AI
// surface so no feature depends on a single vendor's quota.
//
// Order: Cerebras Gemma (fastest; free 1M tokens/day) → Groq gpt-oss-120b
// (free 14,400 req/day) → Gemini 2.5 Flash → Flash-Lite → OpenRouter free
// Gemma-4 (opportunistic last resort — heavily 429-contended, so executors
// only consult it when explicitly budgeted for; the generic chain executors
// skip it). Cerebras/Groq/OpenRouter join the chain only when their API keys
// are configured, so keyless environments keep the Gemini-only behavior.
//
// Cerebras serves Gemma 4 as a PREVIEW endpoint (may be retired on short
// notice) — the model name is env-overridable so ops can swap it without a
// code change. The env vars keep their original COPILOT_* names because they
// are already live in production; they now govern every chain consumer, not
// just the copilot.
//
// Cerebras free-tier limits (2026-07): 5 req/min, 30K tokens/min, 1M
// tokens/day, 65K context. Failures (429s included) fall through to the next
// provider, so bursts beyond those limits degrade to Groq/Gemini rather than
// erroring.

/**
 * Vendor-namespaced options forwarded to the AI SDK (`providerOptions`).
 * Mirrors the SDK's `SharedV3ProviderOptions` (`Record<string, JSONObject>`),
 * which the SDK declares but does not export.
 */
export type ChainProviderOptions = Record<string, Record<string, JSONValue>>;

export interface TextProvider {
  /** Stable identifier for logs/metrics, e.g. "cerebras:gemma-4-31b". */
  name: string;
  model: LanguageModel;
  /**
   * A best-effort bonus pool (contended free tier) that must never have
   * route-deadline time reserved on its behalf — it only runs with whatever
   * time is left after the reliable providers, and only if one of them fails.
   * The generic chain executors skip opportunistic providers entirely.
   */
  opportunistic?: boolean;
  /**
   * Accepts image input parts. Cerebras gemma-4-31b takes base64 data-URI
   * images only (no external URLs); Gemini models take images, PDFs, and
   * URLs. Groq's gpt-oss-120b is text-only.
   */
  vision?: boolean;
}

export function getOpenAiTextModelName(): string {
  return process.env.OPENAI_TEXT_MODEL?.trim() || 'gpt-5-mini';
}

export function getCerebrasTextModelName(): string {
  return process.env.COPILOT_CEREBRAS_MODEL?.trim() || 'gemma-4-31b';
}

export function getGroqTextModelName(): string {
  return process.env.COPILOT_GROQ_MODEL?.trim() || 'openai/gpt-oss-120b';
}

// OpenRouter's free Gemma-4 pool is heavily contended — probes on 2026-07-07
// hit upstream 429 on 25/25 attempts. It stays last and opportunistic.
export const OPENROUTER_TEXT_MODEL_NAME = 'google/gemma-4-31b-it:free';

export function getTextProviderChain(): TextProvider[] {
  const cerebrasApiKey = process.env.CEREBRAS_API_KEY?.trim();
  const groqApiKey = process.env.GROQ_API_KEY?.trim();
  const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();

  const chain: TextProvider[] = [];

  if (cerebrasApiKey) {
    const modelName = getCerebrasTextModelName();
    chain.push({
      name: `cerebras:${modelName}`,
      model: createCerebras({ apiKey: cerebrasApiKey })(modelName),
      vision: true,
    });
  }

  if (groqApiKey) {
    const modelName = getGroqTextModelName();
    chain.push({
      name: `groq:${modelName}`,
      model: createGroq({ apiKey: groqApiKey })(modelName),
    });
  }

  chain.push({
    name: `google:${ACTIVE_TEXT_MODEL_NAME}`,
    model: activeTextModel,
    vision: true,
  });
  chain.push({
    name: `google:${FALLBACK_TEXT_MODEL_NAME}`,
    model: fallbackTextModel,
    vision: true,
  });

  if (openRouterApiKey) {
    chain.push({
      name: `openrouter:${OPENROUTER_TEXT_MODEL_NAME}`,
      model: createOpenAICompatible({
        name: 'openrouter',
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: openRouterApiKey,
      })(OPENROUTER_TEXT_MODEL_NAME),
      opportunistic: true,
      vision: true,
    });
  }

  return chain;
}

/**
 * Onboarding-scoped text/vision chain: places OpenAI first when
 * `OPENAI_API_KEY` is configured and falls back to the platform-wide chain
 * (Cerebras → Groq → Gemini), keeping other platform AI surfaces on their
 * existing free-tier-first routing.
 */
export function getOnboardingTextProviderChain(): TextProvider[] {
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
  const baseChain = getTextProviderChain();
  if (!openAiApiKey) {
    return baseChain;
  }

  const modelName = getOpenAiTextModelName();
  return [
    {
      name: `openai:${modelName}`,
      model: createOpenAICompatible({
        name: 'openai',
        baseURL: 'https://api.openai.com/v1',
        apiKey: openAiApiKey,
      })(modelName),
      vision: true,
    },
    ...baseChain,
  ];
}
