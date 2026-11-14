import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { PiggyvestSavingsScreen } from './PiggyvestSavingsScreen';
import { fixture, policy } from './PiggyvestSavingsScreen.fixture';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('./use-start-savings-controller', () => ({
  useStartSavingsController: () => ({
    isRefetching: false,
    refetch: jest.fn(),
  }),
}));
jest.mock('./StartSavingsForm', () => ({ StartSavingsForm: () => null }));
jest.mock('./StartSavingsModals', () => ({ StartSavingsModals: () => null }));

describe('isolated native PiggyVest savings context', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  it('resets consent and suppresses old completion after context switches and logout', async () => {
    const input = fixture();
    let complete: () => void = () => undefined;
    input.onAccept = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        })
    );
    const view = render(<PiggyvestSavingsScreen staging={input} />);
    fireEvent.press(screen.getByRole('checkbox'));
    fireEvent.press(screen.getByRole('button', { name: 'Accept draft terms' }));
    const next = fixture();
    next.source = {
      ...next.source,
      policy: { ...policy, revisionId: '33333333-3333-4333-8333-333333333333' },
    };
    view.rerender(<PiggyvestSavingsScreen staging={next} />);
    expect(screen.getByRole('checkbox')).toHaveAccessibilityState({
      checked: false,
    });
    await act(async () => {
      complete();
    });
    expect(
      screen.queryByText(
        'Acceptance submitted. Refresh to confirm recorded consent.'
      )
    ).toBeNull();
    view.rerender(
      <PiggyvestSavingsScreen staging={{ ...next, sessionKey: null }} />
    );
    expect(screen.queryByText('Synthetic phone')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
  it('shows purchasing power only for accepted server policy and matched eligible server context, and never a goal bank account', () => {
    const input = fixture();
    input.source = {
      ...input.source,
      policy: { ...policy, consent: 'accepted' },
    };
    const view = render(<PiggyvestSavingsScreen staging={input} />);
    expect(screen.queryByText('0000000000')).toBeNull();
    expect(screen.queryByText('Funding details')).toBeNull();
    expect(screen.getByText('NGN 123.45')).toBeOnTheScreen();
    expect(
      screen.getByText('Pending interest (not spendable): NGN 5.00')
    ).toBeOnTheScreen();
    view.rerender(
      <PiggyvestSavingsScreen
        staging={{
          ...input,
          source: { ...input.source, sessionKey: 'wrong-session' },
        }}
      />
    );
    expect(screen.queryByText('0000000000')).toBeNull();
    expect(screen.queryByText('NGN 123.45')).toBeNull();
  });
});
