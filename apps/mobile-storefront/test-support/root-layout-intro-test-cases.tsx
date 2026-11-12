import { expect, it, jest } from '@jest/globals';
import { act, screen, waitFor } from '@testing-library/react-native';

interface IntroTestContext {
  renderRoot: () => void;
  mockWaitForIntro: jest.Mock<() => Promise<boolean>>;
  mockInitializeStorage: jest.Mock<() => Promise<void>>;
  mockPrefetchStartupStorefrontData: jest.Mock<() => Promise<void>>;
  mockRootLayoutNavMount: jest.Mock;
  mockHideSplash: jest.Mock;
  setFontsLoaded: (loaded: boolean) => void;
}

export function registerRootLayoutIntroTests(context: IntroTestContext) {
  it('initializes data during native playback and mounts navigation only afterward', async () => {
    let completeIntro!: (value: boolean) => void;
    context.mockWaitForIntro.mockReturnValue(
      new Promise<boolean>((resolve) => {
        completeIntro = resolve;
      })
    );
    context.mockInitializeStorage.mockResolvedValue(undefined);
    context.renderRoot();
    await waitFor(() =>
      expect(context.mockPrefetchStartupStorefrontData).toHaveBeenCalled()
    );
    expect(context.mockInitializeStorage).toHaveBeenCalled();
    expect(context.mockRootLayoutNavMount).not.toHaveBeenCalled();
    expect(context.mockHideSplash).not.toHaveBeenCalled();
    expect(screen.queryByTestId('root-layout-nav')).toBeNull();

    await act(async () => completeIntro(true));
    await waitFor(() =>
      expect(context.mockRootLayoutNavMount).toHaveBeenCalledTimes(1)
    );
    expect(context.mockHideSplash).toHaveBeenCalledWith({
      waitForLoop: false,
      minDuration: 0,
      fade: 220,
    });
  });
  it.each([
    'fonts',
    'storage',
  ] as const)('renders a laid-out recovery screen when %s initialization hangs', async (blocked) => {
    context.mockInitializeStorage.mockReturnValue(
      blocked === 'storage'
        ? new Promise<void>(() => {
            /* Simulate initialization that never settles. */
          })
        : Promise.resolve()
    );
    context.mockWaitForIntro.mockReturnValue(
      new Promise(() => {
        /* Simulate a native intro callback that never arrives. */
      })
    );
    context.setFontsLoaded(blocked !== 'fonts');
    context.renderRoot();
    await act(async () => {
      await Promise.resolve();
    });
    expect(context.mockRootLayoutNavMount).not.toHaveBeenCalled();
    expect(context.mockHideSplash).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(8000);
      await Promise.resolve();
    });
    expect(screen.getByTestId('startup-recovery')).toHaveTextContent(
      'Startup recovery'
    );
    expect(screen.queryByTestId('root-layout-nav')).toBeNull();
    await waitFor(() =>
      expect(context.mockHideSplash).toHaveBeenCalledWith({
        waitForLoop: false,
        minDuration: 0,
        fade: 220,
      })
    );
  });
}
