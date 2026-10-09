import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { PrimaryWalletCardPendingView } from './PrimaryWalletCardPendingView';

it('shows accepted funding as pending, not credited or failed, with status-only retry', () => {
  const onCheck = jest.fn();
  const onBack = jest.fn();
  render(
    <PrimaryWalletCardPendingView
      colors={Colors.light}
      statusError={false}
      message={null}
      onCheck={onCheck}
      onBack={onBack}
    />
  );
  expect(screen.getByRole('header').props.children).toBe(
    'Wallet funding pending'
  );
  expect(screen.getByRole('alert').props.children).toContain('once confirmed');
  expect(screen.getByRole('alert').props.children).toContain(
    'Do not pay again'
  );
  expect(screen.queryByText('Payment Failed')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Check funding status' }));
  expect(onCheck).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByRole('button', { name: 'Return to wallet' }));
  expect(onBack).toHaveBeenCalledTimes(1);
});

it('distinguishes a network status failure without inviting another charge', () => {
  render(
    <PrimaryWalletCardPendingView
      colors={Colors.light}
      statusError
      message="Network request failed"
      onCheck={jest.fn()}
      onBack={jest.fn()}
    />
  );
  expect(screen.getByRole('header').props.children).toBe(
    'Could not check funding status'
  );
  expect(screen.getByRole('alert').props.children).toContain(
    'does not mean your card charge failed'
  );
  expect(screen.getByRole('alert').props.children).toContain(
    'Do not pay again'
  );
  expect(screen.queryByText('Try payment again')).toBeNull();
});

it('shows the specific status message alongside the retained-operation copy', () => {
  render(
    <PrimaryWalletCardPendingView
      colors={Colors.light}
      statusError
      message="Network request failed"
      onCheck={jest.fn()}
      onBack={jest.fn()}
    />
  );
  expect(screen.getByText('Network request failed')).toBeOnTheScreen();
  expect(screen.getByRole('alert').props.children).toContain(
    'Do not pay again'
  );
});

it('shows the terminal directive instead of retained-operation copy', () => {
  render(
    <PrimaryWalletCardPendingView
      colors={Colors.light}
      statusError
      message="Network request failed"
      terminalDirective="Start a new funding to try again."
      onCheck={jest.fn()}
      onBack={jest.fn()}
    />
  );
  expect(screen.getByRole('alert').props.children).toContain(
    'Start a new funding to try again.'
  );
  expect(screen.getByRole('alert').props.children).not.toContain(
    'Do not pay again'
  );
});

it('shows only a confirmed operation reference, never an unverified one', () => {
  const { rerender } = render(
    <PrimaryWalletCardPendingView
      colors={Colors.light}
      statusError={false}
      message={null}
      onCheck={jest.fn()}
      onBack={jest.fn()}
    />
  );
  expect(screen.queryByText(/Reference:/)).toBeNull();
  rerender(
    <PrimaryWalletCardPendingView
      colors={Colors.light}
      statusError={false}
      message={null}
      operationReference="pvb-first-primary-confirmed"
      onCheck={jest.fn()}
      onBack={jest.fn()}
    />
  );
  expect(screen.getByText(/Reference:/).props.children).toContain(
    'pvb-first-primary-confirmed'
  );
});
