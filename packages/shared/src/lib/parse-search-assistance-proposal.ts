import {
  type SearchAssistanceProposal,
  searchAssistanceProposalSchema,
} from './search-assistance-proposal-schema';

export function parseSearchAssistanceProposal(
  value: unknown
): SearchAssistanceProposal {
  return searchAssistanceProposalSchema.parse(value);
}
