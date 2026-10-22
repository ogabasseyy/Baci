import { materializeBuilderAiProviderChain } from '@/lib/builder-ai/materialize-builder-ai-provider-chain';
import { prepareBuilderAiEditPrompt } from '@/lib/builder-ai/prepare-builder-ai-edit-prompt';
import { runBuilderAiProviderChain } from '@/lib/builder-ai/run-builder-ai-provider-chain';
import { buildEditCandidate, toBuilderEditData } from './edit-candidate';
import type { EditGenerator } from './run-edit';
/** Existing provider catalog, bounded prompt projection and semantic edit contract only. */
export const generateStorefrontEdit: EditGenerator = ({
  source,
  instructions,
  signal,
}) => {
  const prompt = prepareBuilderAiEditPrompt({
    currentConfig: toBuilderEditData(source),
    prompt: instructions,
  });
  if (!prompt.ok) throw new Error('Edit request too large');
  const { providers } = materializeBuilderAiProviderChain();
  return runBuilderAiProviderChain({
    currentConfig: toBuilderEditData(source),
    deadlineAt: Date.now() + 25000,
    prompt: `${prompt.prompt}\nThis private homepage supports only Header, Hero, Text, Button, ProductGrid, Footer. Preserve rendererVersion baci-home-six-v1. Do not propose zones, HTML, scripts, external links, animations or new media. Header and Footer are protected anchors. Use only existing portable fields.`,
    providerChain: providers,
    signal,
    validateSemantics: (plan) => {
      try {
        buildEditCandidate(source, plan);
        return true;
      } catch {
        return false;
      }
    },
  });
};
