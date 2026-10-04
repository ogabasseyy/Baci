import type { SearchAssistanceProposal } from '@baci/shared/lib';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const { state } = vi.hoisted(() => ({
  state: {
    enabled: true,
    pending: false,
    error: undefined as string | undefined,
    proposal: undefined as SearchAssistanceProposal | undefined,
    ask: vi.fn(),
    dismiss: vi.fn(),
  },
}));
vi.mock('@/hooks/use-search-assistance', () => ({
  useSearchAssistance: () => state,
}));

import { AssistedSearchSuggestions } from './assisted-search-suggestions';

const props = {
  query: 'iphone',
  enabled: true,
  criteria: { brands: [], sort: 'relevance' as const },
  basePath: '/oga/search',
};
beforeEach(() => {
  state.proposal = undefined;
  state.error = undefined;
  state.pending = false;
  vi.clearAllMocks();
});
it('requires an explicit request and renders a validated proposal as a search link', () => {
  const view = render(<AssistedSearchSuggestions {...props} />);
  expect(state.ask).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Ask about this search' })
  );
  expect(state.ask).toHaveBeenCalledTimes(1);
  state.proposal = {
    query: 'iphone',
    explanation: 'Try Apple phones',
    filters: { brands: ['Apple'] },
  };
  view.rerender(<AssistedSearchSuggestions {...props} />);
  expect(
    screen.getByRole('link', { name: 'Apply search suggestions' })
  ).toHaveAttribute('href', '/oga/search?q=iphone&brand=Apple');
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss suggestions' }));
  expect(state.dismiss).toHaveBeenCalled();
});
it('hides the optional flow when disabled', () => {
  render(<AssistedSearchSuggestions {...props} enabled={false} />);
  expect(screen.queryByRole('button')).toBeNull();
});
it('keeps conflicting proposals from navigating', () => {
  state.proposal = {
    query: 'iphone',
    explanation: 'A different budget',
    filters: { minPrice: 200 },
  };
  render(
    <AssistedSearchSuggestions
      {...props}
      criteria={{ ...props.criteria, maxPrice: 100 }}
    />
  );
  expect(screen.getByRole('alert')).toHaveTextContent('conflict');
  expect(screen.queryByRole('link')).toBeNull();
});
