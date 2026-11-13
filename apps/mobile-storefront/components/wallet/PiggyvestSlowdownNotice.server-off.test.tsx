import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
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

  describe('bugfix: the notice ran edge to edge and showed twice', () => {
    it('stays hidden where it is shown elsewhere (the sheet is open)', () => {
      act(() => usePiggyvestSlowdownStore.getState().markSlow('wallet-read'));
      render(<PiggyvestSlowdownNotice hidden />);
      expect(screen.queryByText(PIGGYVEST_SLOWDOWN_MESSAGE)).toBeNull();
    });

    it('uses the card side margins and a gap below on the wallet', () => {
      act(() => usePiggyvestSlowdownStore.getState().markSlow('wallet-read'));
      render(<PiggyvestSlowdownNotice inset />);
      const notice = screen.UNSAFE_getByProps({ accessibilityRole: 'alert' });
      expect(StyleSheet.flatten(notice.props.style)).toMatchObject({
        marginHorizontal: 16,
        marginBottom: 14,
      });
    });
  });
});
