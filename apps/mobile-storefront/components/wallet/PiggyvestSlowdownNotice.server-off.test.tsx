import { act, render, screen } from '@testing-library/react-native';
import { usePiggyvestSlowdownStore } from '@/stores/piggyvest-slowdown-store';
import {
  PIGGYVEST_SLOWDOWN_MESSAGE,
  PiggyvestSlowdownNotice,
} from './PiggyvestSlowdownNotice';

beforeEach(() => usePiggyvestSlowdownStore.setState({ signals: {} }));

describe('PiggyvestSlowdownNotice with PiggyVest off', () => {
  it('renders nothing while PiggyVest is answering normally', () => {
    render(<PiggyvestSlowdownNotice />);
    expect(screen.queryByText(PIGGYVEST_SLOWDOWN_MESSAGE)).toBeNull();
  });

  it('shows one calm line while PiggyVest is slow', () => {
    render(<PiggyvestSlowdownNotice />);
    act(() => usePiggyvestSlowdownStore.getState().markSlow('wallet-read'));
    expect(
      screen.getByText(
        'Savings are running slowly right now. Your money is safe.'
      )
    ).toBeOnTheScreen();
  });
});
