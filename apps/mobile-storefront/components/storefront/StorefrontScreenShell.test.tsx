import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

const mockUseSafeAreaInsets = jest.fn();
const mockUseColorScheme = jest.fn();

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => mockUseColorScheme(),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({
    children,
    testID,
    ...props
  }: {
    children?: React.ReactNode;
    testID?: string;
  }) => {
    const React = jest.requireActual('react') as typeof import('react');
    const { View } = jest.requireActual(
      'react-native'
    ) as typeof import('react-native');

    return React.createElement(
      View,
      { testID: testID ?? 'storefront-screen-shell', ...props },
      children
    );
  },
  useSafeAreaInsets: () => mockUseSafeAreaInsets(),
}));

import { StorefrontScreenShell } from './StorefrontScreenShell';

describe('StorefrontScreenShell', () => {
  beforeEach(() => {
    mockUseColorScheme.mockReturnValue('light');
    mockUseSafeAreaInsets.mockReturnValue({
      top: 24,
      bottom: 34,
      left: 0,
      right: 0,
    });
  });

  it('reserves the bottom and both sides without double-padding the stack header', () => {
    render(
      <StorefrontScreenShell>
        <Text>Content</Text>
      </StorefrontScreenShell>
    );

    const shell = screen.getByTestId('storefront-screen-shell');

    expect(shell.props.edges).toEqual(['bottom', 'left', 'right']);
    expect(StyleSheet.flatten(shell.props.style)).toMatchObject({
      flex: 1,
    });
    expect(screen.getByText('Content')).toBeTruthy();
  });

  it('keeps both side insets when a screen overrides its vertical edges', () => {
    render(
      <StorefrontScreenShell
        edges={['top']}
        style={{ backgroundColor: '#111111' }}
        testID="custom-shell"
      >
        <Text>Content</Text>
      </StorefrontScreenShell>
    );

    const shell = screen.getByTestId('custom-shell');

    expect(shell.props.edges).toEqual(['top', 'left', 'right']);
    expect(StyleSheet.flatten(shell.props.style)).toMatchObject({
      flex: 1,
      backgroundColor: '#111111',
    });
  });

  it('can apply the current theme background before custom styles', () => {
    render(
      <StorefrontScreenShell themeBackground testID="theme-shell">
        <Text>Content</Text>
      </StorefrontScreenShell>
    );

    const shell = screen.getByTestId('theme-shell');

    expect(StyleSheet.flatten(shell.props.style)).toMatchObject({
      backgroundColor: '#FFFFFF',
      flex: 1,
    });
  });

  it('can apply the dark theme background', () => {
    mockUseColorScheme.mockReturnValue('dark');

    render(
      <StorefrontScreenShell themeBackground testID="dark-theme-shell">
        <Text>Content</Text>
      </StorefrontScreenShell>
    );

    const shell = screen.getByTestId('dark-theme-shell');

    expect(StyleSheet.flatten(shell.props.style)).toMatchObject({
      backgroundColor: '#0A0A0A',
      flex: 1,
    });
  });

  it('reserves the sides when the screen handles its own vertical insets', () => {
    render(
      <StorefrontScreenShell edges={[]} testID="empty-shell">
        {null}
      </StorefrontScreenShell>
    );

    const shell = screen.getByTestId('empty-shell');

    expect(shell.props.edges).toEqual(['left', 'right']);
    expect(StyleSheet.flatten(shell.props.style)).toMatchObject({
      flex: 1,
    });
  });
});
