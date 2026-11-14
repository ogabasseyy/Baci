import { expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type React from 'react';

export function registerRootLayoutNavStartupTests(input: {
  RootLayoutNav: React.ComponentType<{
    persistenceEnabled?: boolean;
    onFirstLayout?: () => void;
  }>;
}) {
  const { RootLayoutNav } = input;

  it('reports a layout from the app shell', () => {
    const onFirstLayout = jest.fn();
    const { UNSAFE_getByProps } = render(
      <RootLayoutNav onFirstLayout={onFirstLayout} />
    );
    fireEvent(UNSAFE_getByProps({ onLayout: onFirstLayout }), 'layout');
    expect(onFirstLayout).toHaveBeenCalledTimes(1);
  });

  it('mounts update prompts only after the native splash handoff', () => {
    const view = render(<RootLayoutNav persistenceEnabled={false} />);
    expect(screen.queryByText('update-controller')).toBeNull();

    view.rerender(<RootLayoutNav persistenceEnabled />);
    expect(screen.getByText('update-controller')).toBeTruthy();
  });

  it('pauses underlying motion until the native splash handoff', () => {
    const view = render(<RootLayoutNav persistenceEnabled={false} />);
    expect(screen.getByText('startup-motion:off')).toBeTruthy();

    view.rerender(<RootLayoutNav persistenceEnabled />);
    expect(screen.getByText('startup-motion:on')).toBeTruthy();
  });
}
