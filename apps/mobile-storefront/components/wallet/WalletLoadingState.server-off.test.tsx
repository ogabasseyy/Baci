import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import {
  WALLET_LOAD_FAILED_COPY,
  WALLET_LOAD_TIMEOUT_MS,
  WalletLoadingState,
} from './WalletLoadingState';

afterEach(() => {
  jest.useRealTimers();
});

describe('bugfix: wallet spinner never ends when the wallet read hangs', () => {
  it('turns into "We couldn\'t load your wallet" with Try again after the timeout', () => {
    // Arrange: the wallet read never answers.
    jest.useFakeTimers();
    const onRetry = jest.fn();
    render(
      <WalletLoadingState
        colors={Colors.light}
        message="Preparing your wallet..."
        onRetry={onRetry}
      />
    );
    expect(screen.getByLabelText('Preparing wallet')).toBeOnTheScreen();

    // Act
    act(() => {
      jest.advanceTimersByTime(WALLET_LOAD_TIMEOUT_MS);
    });

    // Assert
    expect(screen.getByText(WALLET_LOAD_FAILED_COPY)).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    // A retry shows the spinner again while it runs.
    expect(screen.getByLabelText('Preparing wallet')).toBeOnTheScreen();
  });

  it('offers Try again straight away when the load failed', () => {
    render(
      <WalletLoadingState
        colors={Colors.light}
        message="Unable to load wallet."
        onRetry={jest.fn()}
      />
    );

    expect(screen.getByText(WALLET_LOAD_FAILED_COPY)).toBeOnTheScreen();
  });
});

describe('server keeps PiggyVest off', () => {
  it('shows the spinner while the load is still within its time', () => {
    render(
      <WalletLoadingState
        colors={Colors.light}
        message="Preparing your wallet..."
        onRetry={jest.fn()}
      />
    );

    expect(screen.getByLabelText('Preparing wallet')).toBeOnTheScreen();
    expect(screen.queryByText(WALLET_LOAD_FAILED_COPY)).toBeNull();
  });
});
