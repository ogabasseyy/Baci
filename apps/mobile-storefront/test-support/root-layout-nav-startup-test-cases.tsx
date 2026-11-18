import { expect, it, jest } from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type React from 'react';

export function registerRootLayoutNavStartupTests(input: {
  RootLayoutNav: React.ComponentType<{
    persistenceEnabled?: boolean;
    startupReady?: boolean;
    onFirstLayout?: () => void;
  }>;
  queryProvider: jest.Mock<
    (props: {
      children?: React.ReactNode;
      persistenceEnabled?: boolean;
    }) => React.JSX.Element
  >;
}) {
  const { RootLayoutNav, queryProvider } = input;

  it('reports a layout from the app shell after router readiness', async () => {
    const onFirstLayout = jest.fn();
    const view = render(<RootLayoutNav onFirstLayout={onFirstLayout} />);
    fireEvent(view.getByTestId('root-app-shell'), 'layout');
    await waitFor(() => expect(onFirstLayout).toHaveBeenCalledTimes(1));
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

  it('passes persistence settings through to the query provider', () => {
    render(<RootLayoutNav persistenceEnabled={false} />);

    expect(queryProvider).toHaveBeenCalledWith(
      expect.objectContaining({ persistenceEnabled: false })
    );
  });

  it('passes keyboard startup readiness independently of persistence', () => {
    render(<RootLayoutNav persistenceEnabled={false} startupReady />);

    expect(screen.getByText('keyboard-startup:true')).toBeTruthy();
    expect(queryProvider).toHaveBeenCalledWith(
      expect.objectContaining({ persistenceEnabled: false })
    );
  });

  it('surfaces provider failures deterministically', () => {
    queryProvider.mockImplementation(() => {
      throw new Error('query provider failed');
    });

    expect(() => render(<RootLayoutNav />)).toThrow('query provider failed');
  });
}
