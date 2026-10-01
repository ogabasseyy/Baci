import type { BuilderData } from '@baci/shared/contracts';
import {
  type getBuilderAiStructuralBaseline,
  validateBuilderAiCandidate,
} from './builder-ai-structure-guards';

export function getBuilderAiValidCandidate(
  candidateConfig: BuilderData,
  baseline: ReturnType<typeof getBuilderAiStructuralBaseline>,
  createError: new (message: string) => Error
): BuilderData {
  const validation = validateBuilderAiCandidate(candidateConfig, baseline);
  if ('failure' in validation) throw new createError(validation.failure);
  return validation.candidateConfig;
}
