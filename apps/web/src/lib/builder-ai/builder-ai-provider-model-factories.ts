import { createCerebras } from '@ai-sdk/cerebras';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  BUILDER_AI_CEREBRAS_MODEL,
  BUILDER_AI_GOOGLE_MODEL,
  BUILDER_AI_GROQ_MODEL,
  BUILDER_AI_OPENROUTER_MODEL,
  type BuilderAiProviderFactories,
} from './builder-ai-provider-catalog';

export const builderAiProviderModelFactories: BuilderAiProviderFactories = {
  createCerebrasModel: (apiKey) =>
    createCerebras({ apiKey })(BUILDER_AI_CEREBRAS_MODEL),
  createGoogleModel: (apiKey) =>
    createGoogleGenerativeAI({ apiKey })(BUILDER_AI_GOOGLE_MODEL),
  createGroqModel: (apiKey) => createGroq({ apiKey })(BUILDER_AI_GROQ_MODEL),
  createOpenRouterModel: (apiKey) =>
    createOpenAICompatible({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      name: 'openrouter',
    })(BUILDER_AI_OPENROUTER_MODEL),
};
