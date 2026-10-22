import {
  builderAiEditContract,
  validateBuilderAiEditComplexity,
} from '@baci/shared/contracts';
import { applyBuilderAiEditPlan } from '@/lib/builder-ai/apply-builder-ai-edit-plan';
import {
  getBuilderAiStructuralBaseline,
  validateBuilderAiCandidate,
} from '@/lib/builder-ai/builder-ai-structure-guards';
import { getBuilderAiRawPlanMediaWarning } from '@/lib/builder-ai/get-builder-ai-raw-plan-media-warning';
import { hasDuplicateBuilderAiComponentIds } from '@/lib/builder-ai/has-duplicate-builder-ai-component-ids';
import {
  type PortableHome,
  portableHomeSchema,
} from '@/schemas/portable-storefront';
export function toBuilderEditData(source: PortableHome) {
  return builderAiEditContract.builderDataSchema.parse(source);
}
export function validateEditSource(source: unknown): PortableHome {
  const parsed = portableHomeSchema.parse(source);
  if (
    hasDuplicateBuilderAiComponentIds(toBuilderEditData(parsed)) ||
    !validateBuilderAiEditComplexity(toBuilderEditData(parsed)).success
  )
    throw new Error('Invalid edit source');
  return parsed;
}
export function buildEditCandidate(
  source: unknown,
  output: unknown
): PortableHome {
  const current = validateEditSource(source);
  if (getBuilderAiRawPlanMediaWarning(output))
    throw new Error('Invalid edit candidate');
  const plan = builderAiEditContract.modelPlanSchema.parse(output);
  if (plan.status !== 'proposed') throw new Error('Edit request unsupported');
  const { candidateConfig, warnings } = applyBuilderAiEditPlan(
    toBuilderEditData(current),
    plan
  );
  // Silent sanitizer drops must not turn unsafe output into a ready candidate.
  if (warnings.length > 0) throw new Error('Invalid edit candidate');
  const candidate = validateEditSource(candidateConfig);
  if (JSON.stringify(candidate) === JSON.stringify(current))
    throw new Error('No safe changes');
  return candidate;
}

export function validateStoredCandidate(
  source: unknown,
  value: unknown
): PortableHome {
  const current = validateEditSource(source);
  const candidate = validateEditSource(value);
  const result = validateBuilderAiCandidate(
    toBuilderEditData(candidate),
    getBuilderAiStructuralBaseline(toBuilderEditData(current))
  );
  if ('failure' in result) throw new Error('Invalid edit candidate');
  return candidate;
}
