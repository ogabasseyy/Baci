import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { DrawerMenuFooter } from './DrawerMenuFooter';

const colors = {
  background: '#ffffff',
  border: '#e5e5e5',
  foreground: '#111111',
  muted: '#f5f5f5',
  textSecondary: '#666666',
};

const baseProps = {
  appVersion: '1.2.3',
  bottomInset: 20,
  colors,
  currentYear: 2026,
  onAuthPress: () => {},
};

describe('DrawerMenuFooter', () => {
  it('offers login or register when unauthenticated', () => {
    // Arrange & Act
    render(<DrawerMenuFooter {...baseProps} isAuthenticated={false} />);

    // Assert
    expect(screen.getByText('Login / Register')).toBeTruthy();
    expect(screen.getByText(/v1\.2\.3.*2026/)).toBeTruthy();
  });

  it('offers sign out when authenticated', () => {
    // Arrange & Act
    render(<DrawerMenuFooter {...baseProps} isAuthenticated />);

    // Assert
    expect(screen.getByText('Sign Out')).toBeTruthy();
  });

  it('invokes the auth handler on press', () => {
    // Arrange
    const onAuthPress = jest.fn();

    // Act
    render(
      <DrawerMenuFooter
        {...baseProps}
        isAuthenticated={false}
        onAuthPress={onAuthPress}
      />
    );
    fireEvent.press(screen.getByText('Login / Register'));

    // Assert
    expect(onAuthPress).toHaveBeenCalledTimes(1);
  });
});
