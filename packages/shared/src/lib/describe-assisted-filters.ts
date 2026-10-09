import type { SearchAssistanceProposal } from './shopping-assistance';

export function describeAssistedFilters(
  proposal: SearchAssistanceProposal
): string[] {
  const filters = proposal.filters;
  return [
    ...(filters.brands ?? []),
    filters.condition === 'open_box' ? 'Open box' : filters.condition,
    filters.minPrice === undefined
      ? undefined
      : `From ₦${filters.minPrice.toLocaleString('en-NG')}`,
    filters.maxPrice === undefined
      ? undefined
      : `Up to ₦${filters.maxPrice.toLocaleString('en-NG')}`,
  ].filter((value): value is string => Boolean(value));
}
