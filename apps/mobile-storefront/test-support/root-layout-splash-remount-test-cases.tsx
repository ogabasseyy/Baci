import { expect, it, type jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react-native';
import type React from 'react';

interface SplashRemountTestContext {
  RootLayout: React.ComponentType;
  initializeStorage: jest.Mock<() => Promise<void>>;
  hideSplash: jest.Mock<(options: unknown) => Promise<void>>;
  finishNativeSplash: () => Promise<void>;
}

export function registerRootLayoutSplashRemountTests({
  RootLayout,
  initializeStorage,
  hideSplash,
  finishNativeSplash,
}: SplashRemountTestContext) {
  it('does not replay the animated splash after a completed boot remount', async () => {
    initializeStorage.mockResolvedValue(undefined);
    const firstRender = render(<RootLayout />);

    await waitFor(() => {
      expect(screen.getByTestId('root-layout-nav')).toHaveTextContent(
        'adTracking:true;persistence:false;resume:false'
      );
    });
    await finishNativeSplash();

    await waitFor(() =>
      expect(screen.getByTestId('root-layout-nav')).toHaveTextContent(
        'adTracking:true;persistence:true;resume:true'
      )
    );

    firstRender.unmount();
    render(<RootLayout />);
    await waitFor(() => {
      expect(screen.getByTestId('root-layout-nav')).toHaveTextContent(
        'adTracking:true;persistence:true;resume:true'
      );
    });
    expect(hideSplash).toHaveBeenCalledTimes(1);
  });
}
