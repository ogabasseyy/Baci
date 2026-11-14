import { expect, it, jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import type React from 'react';

export function registerRootLayoutPendingSplashRecoveryTest({
  RootLayout,
  initializeStorage,
  hideSplash,
  isSplashVisible,
  rootLayoutNavUnmount,
}: {
  RootLayout: React.ComponentType;
  initializeStorage: jest.Mock<() => Promise<void>>;
  hideSplash: jest.Mock<(options: unknown) => Promise<void>>;
  isSplashVisible: jest.Mock<() => boolean>;
  rootLayoutNavUnmount: jest.Mock;
}) {
  it('keeps navigation mounted until a pending hide recovery attempt settles', async () => {
    initializeStorage.mockResolvedValue(undefined);
    isSplashVisible.mockImplementation(() => {
      throw new Error('native visibility unavailable');
    });
    let rejectRecovery!: (error: Error) => void;
    hideSplash
      .mockRejectedValueOnce(new Error('native hide failed'))
      .mockRejectedValueOnce(new Error('native hide fallback failed'))
      .mockReturnValueOnce(
        new Promise<void>((_resolve, reject) => {
          rejectRecovery = reject;
        })
      );

    render(<RootLayout />);

    await waitFor(() => expect(hideSplash).toHaveBeenCalledTimes(3));
    expect(screen.getByTestId('root-layout-nav')).toBeOnTheScreen();
    expect(screen.queryByTestId('startup-recovery-screen')).toBeNull();
    expect(rootLayoutNavUnmount).not.toHaveBeenCalled();

    act(() => jest.advanceTimersByTime(8_000));
    expect(screen.getByTestId('root-layout-nav')).toBeOnTheScreen();
    expect(screen.queryByTestId('startup-recovery-screen')).toBeNull();

    await act(async () => rejectRecovery(new Error('bounded recovery failed')));
    await waitFor(() =>
      expect(screen.getByTestId('startup-recovery-screen')).toBeOnTheScreen()
    );
    expect(screen.queryByTestId('root-layout-nav')).toBeNull();
    expect(rootLayoutNavUnmount).toHaveBeenCalledTimes(1);
  });
}
