import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ props: vi.fn() }));

vi.mock('react-native-keyboard-controller', () => ({
  KeyboardProvider: ({
    children,
    ...props
  }: { children: ReactNode } & Record<string, unknown>) => {
    mocks.props(props);
    return <div data-testid="keyboard-provider">{children}</div>;
  },
}));

import { AppKeyboardProvider } from './AppKeyboardProvider';

describe('AppKeyboardProvider', () => {
  it('wraps the app in the keyboard tracker', () => {
    render(
      <AppKeyboardProvider>
        <span>App</span>
      </AppKeyboardProvider>
    );

    expect(screen.getByTestId('keyboard-provider')).toBeTruthy();
    expect(screen.getByText('App')).toBeTruthy();
  });

  it('keeps edge-to-edge as the app has it and does not preload the keyboard', () => {
    render(
      <AppKeyboardProvider>
        <span>App</span>
      </AppKeyboardProvider>
    );

    // Preloading focuses a hidden iOS field, which can stall launch.
    expect(mocks.props).toHaveBeenCalledWith(
      expect.objectContaining({
        navigationBarTranslucent: true,
        preload: false,
        preserveEdgeToEdge: true,
        statusBarTranslucent: true,
      })
    );
  });
});
