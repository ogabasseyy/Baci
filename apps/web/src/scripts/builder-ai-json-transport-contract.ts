export interface BuilderAiJsonTransportProviderDescriptor {
  name: string;
  opportunistic?: boolean;
}

const APPROVED_GOOGLE_MODEL_NAME = 'gemma-4-31b-it';
const APPROVED_GROQ_MODEL_NAME = 'openai/gpt-oss-120b';
const PINNED_OPENROUTER_NAME = 'openrouter:google/gemma-4-31b-it:free';

function getProviderIdentity(name: string): { alias: string; model: string } {
  const separator = name.indexOf(':');
  if (separator < 1 || separator === name.length - 1) {
    return { alias: 'unknown', model: 'unknown' };
  }
  return { alias: name.slice(0, separator), model: name.slice(separator + 1) };
}

function hasApprovedModelIdentity(
  name: string,
  alias: string,
  model: string
): boolean {
  const identity = getProviderIdentity(name);
  return identity.alias === alias && identity.model === model;
}

function hasCanonicalProviderOrder(
  providers: BuilderAiJsonTransportProviderDescriptor[]
): boolean {
  const reliableProviders = [
    `google:${APPROVED_GOOGLE_MODEL_NAME}`,
    `groq:${APPROVED_GROQ_MODEL_NAME}`,
  ];
  return (
    reliableProviders.every(
      (name, index) => providers[index]?.name === name
    ) &&
    (providers.length === 2 ||
      (providers.length === 3 &&
        providers[2]?.name === PINNED_OPENROUTER_NAME &&
        providers[2]?.opportunistic === true))
  );
}

export const builderAiJsonTransportContract = {
  getProviderIdentity,
  hasCanonicalProviderOrder,
};
