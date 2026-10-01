import {
  type BuilderAiEditCandidate,
  builderAiEditContract,
} from '@baci/shared/contracts';

export function parseBuilderAiEditCandidate(
  candidate: unknown
): BuilderAiEditCandidate {
  return builderAiEditContract.candidateSchema.parse(candidate);
}
