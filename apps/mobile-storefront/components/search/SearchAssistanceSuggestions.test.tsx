import type { SearchAssistanceProposal } from '@baci/shared/lib';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';

const mockAssistance = {
  enabled: false,
  pending: false,
  error: undefined as string | undefined,
  proposal: undefined as SearchAssistanceProposal | undefined,
  ask: jest.fn(),
  dismiss: jest.fn(),
};
jest.mock('@/hooks/use-search-assistance', () => ({
  useSearchAssistance: () => mockAssistance,
}));

import SearchAssistanceSuggestions from './SearchAssistanceSuggestions';

const props = {
  query: 'iphone',
  resultQuery: 'iphone',
  products: [],
  colors: Colors.light,
  onApply: jest.fn(),
};
beforeEach(() => {
  mockAssistance.enabled = false;
  mockAssistance.pending = false;
  mockAssistance.proposal = undefined;
  mockAssistance.error = undefined;
  jest.clearAllMocks();
});
it('keeps assistance hidden when it is disabled', () => {
  render(<SearchAssistanceSuggestions {...props} />);
  expect(screen.queryByText('Ask about this search')).toBeNull();
  expect(mockAssistance.ask).not.toHaveBeenCalled();
});
it('asks only after an explicit tap and applies a proposal only after approval', () => {
  mockAssistance.enabled = true;
  const view = render(<SearchAssistanceSuggestions {...props} />);
  expect(mockAssistance.ask).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Ask about this search'));
  expect(mockAssistance.ask).toHaveBeenCalledTimes(1);
  mockAssistance.proposal = {
    query: 'iphone',
    explanation: 'Try Apple phones',
    filters: { brands: ['Apple'] },
  };
  view.rerender(<SearchAssistanceSuggestions {...props} />);
  expect(props.onApply).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Apply search suggestions'));
  expect(props.onApply).toHaveBeenCalledWith(mockAssistance.proposal);
  expect(mockAssistance.dismiss).toHaveBeenCalled();
});
it('keeps search available when assistance fails', () => {
  mockAssistance.enabled = true;
  mockAssistance.error = 'Keep searching or try again.';
  render(<SearchAssistanceSuggestions {...props} />);
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.getByText('Ask about this search')).toBeTruthy();
});
