import { expect, it, jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import type React from 'react';

export function registerRootLayoutTimeoutPlaceholderTests(input: {
  RootLayout: React.ComponentType;
  initializeStorage: jest.Mock<() => Promise<void>>;
  hideSplash: jest.Mock<(options: unknown) => Promise<void>>;
  isSplashVisible: jest.Mock<() => boolean>;
}) {
  it('keeps the startup background while timeout recovery waits on native visibility', async () => {
    input.initializeStorage.mockReturnValue(new Promise(() => undefined));
    input.isSplashVisible.mockReturnValue(true);
    render(<input.RootLayout />);

    act(() => jest.advanceTimersByTime(8_000));
    await waitFor(() => expect(input.hideSplash).toHaveBeenCalledTimes(1));

    expect(screen.getByTestId('startup-placeholder')).toBeOnTheScreen();
    expect(screen.getByText('Getting things ready…')).toBeOnTheScreen();
    expect(screen.queryByTestId('startup-recovery-screen')).toBeNull();
  });
}
