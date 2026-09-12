import {
  type BuilderAiMaterializationPurpose,
  type BuilderAiProvider,
  type BuilderAiProviderEnvironment,
  type BuilderAiProviderFactories,
  materializeBuilderAiProviders,
} from './builder-ai-provider-catalog';
import { builderAiProviderModelFactories } from './builder-ai-provider-model-factories';

export type BuilderAiProviderMaterialization =
  | { providers: BuilderAiProvider[] }
  | { code: 'ai_provider_unavailable'; providers: [] };

function runtimeEnvironment(): BuilderAiProviderEnvironment {
  return {
    CEREBRAS_API_KEY: process.env.CEREBRAS_API_KEY,
    CEREBRAS_BUILDER_ACCOUNT_REF: process.env.CEREBRAS_BUILDER_ACCOUNT_REF,
    CEREBRAS_BUILDER_CREDENTIAL_BINDING_TAG:
      process.env.CEREBRAS_BUILDER_CREDENTIAL_BINDING_TAG,
    CEREBRAS_BUILDER_DEPLOYMENT_TIER:
      process.env.CEREBRAS_BUILDER_DEPLOYMENT_TIER,
    CEREBRAS_BUILDER_APPROVED_MODEL:
      process.env.CEREBRAS_BUILDER_APPROVED_MODEL,
    CEREBRAS_BUILDER_RELEASE_ATTESTED_AT:
      process.env.CEREBRAS_BUILDER_RELEASE_ATTESTED_AT,
    GOOGLE_GENAI_API_KEY: process.env.GOOGLE_GENAI_API_KEY,
    GOOGLE_BUILDER_ACCOUNT_REF: process.env.GOOGLE_BUILDER_ACCOUNT_REF,
    GOOGLE_BUILDER_CREDENTIAL_BINDING_TAG:
      process.env.GOOGLE_BUILDER_CREDENTIAL_BINDING_TAG,
    GOOGLE_BUILDER_DEPLOYMENT_TIER: process.env.GOOGLE_BUILDER_DEPLOYMENT_TIER,
    GOOGLE_BUILDER_APPROVED_MODEL: process.env.GOOGLE_BUILDER_APPROVED_MODEL,
    GOOGLE_BUILDER_RELEASE_ATTESTED_AT:
      process.env.GOOGLE_BUILDER_RELEASE_ATTESTED_AT,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    GROQ_BUILDER_ACCOUNT_REF: process.env.GROQ_BUILDER_ACCOUNT_REF,
    GROQ_BUILDER_CREDENTIAL_BINDING_TAG:
      process.env.GROQ_BUILDER_CREDENTIAL_BINDING_TAG,
    GROQ_BUILDER_DEPLOYMENT_TIER: process.env.GROQ_BUILDER_DEPLOYMENT_TIER,
    GROQ_BUILDER_APPROVED_MODEL: process.env.GROQ_BUILDER_APPROVED_MODEL,
    GROQ_BUILDER_RELEASE_ATTESTED_AT:
      process.env.GROQ_BUILDER_RELEASE_ATTESTED_AT,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_BUILDER_TRANSPORT_APPROVED_AT:
      process.env.OPENROUTER_BUILDER_TRANSPORT_APPROVED_AT,
    OPENROUTER_BUILDER_TRANSPORT_APPROVED_MODEL:
      process.env.OPENROUTER_BUILDER_TRANSPORT_APPROVED_MODEL,
    BUILDER_AI_PROVIDER_BINDING_PEPPER:
      process.env.BUILDER_AI_PROVIDER_BINDING_PEPPER,
  };
}

export function materializeBuilderAiProviderChain(
  environment: BuilderAiProviderEnvironment = runtimeEnvironment(),
  factories: BuilderAiProviderFactories = builderAiProviderModelFactories,
  purpose: BuilderAiMaterializationPurpose = 'runtime'
): BuilderAiProviderMaterialization {
  const providers = materializeBuilderAiProviders(environment, factories, {
    purpose,
  });
  return providers.length > 0
    ? { providers }
    : { code: 'ai_provider_unavailable', providers: [] };
}
