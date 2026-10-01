import {
  type BuilderAiEditRequest,
  builderAiEditContract,
} from '@baci/shared/contracts';

export function buildBuilderAiEditRequest(
  request: Omit<BuilderAiEditRequest, 'contractVersion'>
): BuilderAiEditRequest {
  return builderAiEditContract.requestSchema.parse({
    ...request,
    contractVersion: builderAiEditContract.version,
  });
}
