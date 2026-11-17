import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type {
  ChainProviderOptions,
  TextProvider,
} from '@/ai/text-provider-chain';

export const OGABASSEY_NEGOTIATION =
  /\b(?:negotiat\w*|discount\w*|haggl\w*|(?:last|final)\s+price|(?:reduce|lower)\s+(?:the\s+|your\s+)?(?:price|cost)|bargain|deal)\b/i;

export const OGABASSEY_UNVERIFIED_MUTATION_ACTION =
  /\b(?:cancel(?:l)?ed|refunded|charged|shipped|delivered|arrived|paid)\b|\b(?:order|payment|purchase|transfer|account|transaction|receipt|checkout|cart)\b[^.!?\n]{0,80}\b(?:confirmed|processed|completed|successful|received|placed|created|generated|issued|ready|activated|settled|approved|sent)\b|\b(?:confirmed|processed|completed|placed|created|generated|issued|opened|sent)\b[^.!?\n]{0,80}\b(?:order|payment|purchase|transfer|account|transaction|receipt|checkout|cart)\b|\b(?:i|we)(?:['’](?:ve|ll)|\s+(?:have|will|just))?\s+(?:did|done|handled|completed|processed|created|issued|sent)\s+(?:it|that|this)\b/i;

export const OGABASSEY_UNVERIFIED_COMMERCE_ACTION = new RegExp(
  `${OGABASSEY_UNVERIFIED_MUTATION_ACTION.source}|\\b(?:we|i|our store)\\s+(?:sell|stock|carry|offer)\\b|\\b(?:we|i|our store)\\s+have\\s+(?!no\\b|not\\b|never\\b)`,
  'i'
);

export const OGABASSEY_UNVERIFIED_STORE_PURCHASE =
  /\b(?:buy|purchase|order|get)\b[^.!?\n]{0,100}\b(?:from|at)\s+(?:us|our\s+(?:store|shop))\b|\b(?:ready|available)\s+(?:to|for)\s+(?:buy|purchase|order|sale)\b/i;

export const OGABASSEY_MODEL_PROVIDER_OPTIONS: ChainProviderOptions = {
  openai: {
    reasoningEffort: 'none',
    store: false,
    service_tier: 'default',
  },
  meta: {
    // muse-ember-1.0 defaults to reasoning_effort="max" and rejects "none" (HTTP 400);
    // "minimal" keeps latency and token budget bounded for customer chat.
    reasoningEffort: 'minimal',
  },
  deepseek: { thinking: { type: 'disabled' } },
};

export function getOgabasseyPreferredProviders(
  options: { includeDeepSeek?: boolean } = {}
): TextProvider[] {
  const providers: TextProvider[] = [];
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const metaKey = process.env.META_MODEL_API_KEY?.trim();
  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();

  if (openaiKey) {
    providers.push({
      name: 'openai:gpt-6-luna',
      model: createOpenAICompatible({
        name: 'openai',
        baseURL: 'https://api.openai.com/v1',
        apiKey: openaiKey,
        transformRequestBody: ({ max_tokens, ...body }) => ({
          ...body,
          ...(max_tokens === undefined
            ? {}
            : { max_completion_tokens: max_tokens }),
        }),
      }).chatModel('gpt-6-luna'),
    });
  }

  if (metaKey) {
    providers.push({
      name: 'meta:muse-ember-1.0',
      model: createOpenAICompatible({
        name: 'meta',
        baseURL: 'https://api.meta.ai/v1',
        apiKey: metaKey,
      }).chatModel('muse-ember-1.0'),
    });
  }

  if (options.includeDeepSeek && deepseekKey) {
    providers.push({
      name: 'deepseek:deepseek-flash',
      model: createOpenAICompatible({
        name: 'deepseek',
        baseURL: 'https://api.deepseek.com',
        apiKey: deepseekKey,
      }).chatModel('deepseek-flash'),
    });
  }

  return providers;
}
