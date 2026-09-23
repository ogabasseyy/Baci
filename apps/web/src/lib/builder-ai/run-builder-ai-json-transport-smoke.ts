import {
  type BuilderData,
  builderAiEditContract,
} from '@baci/shared/contracts';
import { generateText, Output } from 'ai';
import { applyBuilderAiEditPlan } from './apply-builder-ai-edit-plan';
import { builderAiPlanOutputBudget } from './builder-ai-plan-output-budget';
import type { BuilderAiProvider } from './builder-ai-provider-catalog';

export const BUILDER_AI_JSON_SMOKE_PROMPT =
  'Return exactly this JSON object and no other content: {"status":"proposed","summary":"Smoke checked","operations":[{"kind":"update_component","componentId":"smoke-hero","patch":{"componentType":"Hero","title":"Smoke checked"}}]}';

const config: BuilderData = {
  content: [{ props: { id: 'smoke-hero', title: 'Smoke' }, type: 'Hero' }],
  root: { title: 'Smoke' },
};

function hasExactSmokeCandidateConfig(candidate: BuilderData): boolean {
  const [component] = candidate.content;
  return (
    Object.keys(candidate).length === 2 &&
    candidate.content.length === 1 &&
    Object.keys(candidate.root).length === 1 &&
    candidate.root.title === 'Smoke' &&
    component?.type === 'Hero' &&
    Object.keys(component).length === 2 &&
    Object.keys(component.props).length === 2 &&
    component.props.id === 'smoke-hero' &&
    component.props.title === 'Smoke checked'
  );
}

export function isValidBuilderAiJsonTransportSmokeResult(
  output: unknown
): boolean {
  const parsed = builderAiEditContract.modelPlanSchema.safeParse(output);
  if (!parsed.success || parsed.data.status !== 'proposed') return false;
  const [operation] = parsed.data.operations;
  if (
    parsed.data.operations.length !== 1 ||
    operation?.kind !== 'update_component' ||
    operation.componentId !== 'smoke-hero' ||
    operation.patch.componentType !== 'Hero' ||
    operation.patch.title !== 'Smoke checked' ||
    Object.keys(operation.patch).length !== 2
  ) {
    return false;
  }
  try {
    const result = applyBuilderAiEditPlan(
      config,
      parsed.data,
      (type) => `smoke-${type}`
    );
    return (
      result.warnings.length === 0 &&
      hasExactSmokeCandidateConfig(result.candidateConfig)
    );
  } catch {
    return false;
  }
}

export async function runBuilderAiJsonTransportSmoke(
  provider: Pick<BuilderAiProvider, 'model' | 'name'>,
  signal: AbortSignal
): Promise<boolean> {
  if (
    !builderAiPlanOutputBudget.isApproved(
      builderAiPlanOutputBudget.maxOutputTokens
    )
  ) {
    throw new Error('Builder AI output budget is not approved');
  }
  const result = await generateText({
    abortSignal: signal,
    maxOutputTokens: builderAiPlanOutputBudget.maxOutputTokens,
    maxRetries: 0,
    model: provider.model,
    output: Output.json(),
    prompt: BUILDER_AI_JSON_SMOKE_PROMPT,
  });
  return isValidBuilderAiJsonTransportSmokeResult(result.output);
}
