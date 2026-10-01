import {
  BUILDER_AI_CEREBRAS_MODEL,
  BUILDER_AI_GOOGLE_MODEL,
  BUILDER_AI_GROQ_MODEL,
  BUILDER_AI_OPENROUTER_MODEL,
} from './builder-ai-provider-catalog';

interface ProviderOrderEntry {
  name: string;
  opportunistic?: boolean;
}

export function hasCanonicalBuilderAiProviderOrder(
  providers: ProviderOrderEntry[]
): boolean {
  const reliablePairs = [
    [`google:${BUILDER_AI_GOOGLE_MODEL}`, `groq:${BUILDER_AI_GROQ_MODEL}`],
    [`cerebras:${BUILDER_AI_CEREBRAS_MODEL}`, `groq:${BUILDER_AI_GROQ_MODEL}`],
  ];
  if (
    !reliablePairs.some((pair) =>
      pair.every((name, index) => providers[index]?.name === name)
    )
  ) {
    return false;
  }
  return (
    providers.length === 2 ||
    (providers.length === 3 &&
      providers[2]?.name === `openrouter:${BUILDER_AI_OPENROUTER_MODEL}` &&
      providers[2]?.opportunistic === true)
  );
}
