import {
  type BuilderAiEditPlan,
  type BuilderAiEditRequest,
  builderAiEditContract,
} from '@baci/shared/contracts';
import { applyBuilderAiEditPlan } from '@/lib/builder-ai/apply-builder-ai-edit-plan';
import { builderGeminiRequestSchema } from '@/schemas/builder-gemini-request';
export function isSemanticallyExecutable(
  plan: BuilderAiEditPlan,
  request: BuilderAiEditRequest
): boolean {
  if (plan.status === 'refused') return true;
  try {
    applyBuilderAiEditPlan(request.currentConfig, plan);
    return true;
  } catch {
    return false;
  }
}
export function parseRequest(
  body: unknown,
  mode: 'legacy' | 'v1'
): BuilderAiEditRequest | null {
  if (mode === 'v1') {
    const parsed = builderAiEditContract.requestSchema.safeParse(body);
    return parsed.success ? parsed.data : null;
  }
  const legacy = builderGeminiRequestSchema.safeParse(body);
  return legacy.success
    ? {
        ...legacy.data,
        clientRequestId: crypto.randomUUID(),
        contractVersion: builderAiEditContract.version,
      }
    : null;
}
