import { render, screen } from '@testing-library/react-native';
import { useColorScheme } from 'react-native';
import { darkTheme, lightTheme } from '@/constants/themes';
import { Toast } from './Toast';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'light'),
}));

const mockUseColorScheme = useColorScheme as jest.MockedFunction<
  typeof useColorScheme
>;

describe('Toast', () => {
  beforeEach(() => {
    mockUseColorScheme.mockReturnValue('light');
  });

  it('never renders an icon-only bar for an empty message', () => {
    render(
      <Toast message="   " onDismiss={jest.fn()} variant="error" visible />
    );

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the message when it has text', () => {
    render(
      <Toast
        message="Could not save address"
        onDismiss={jest.fn()}
        variant="error"
        visible
      />
    );

    expect(screen.getByText('Could not save address')).toBeTruthy();
  });

  it.each([
    ['light', lightTheme],
    ['dark', darkTheme],
  ] as const)('keeps error text readable in %s mode', (scheme, theme) => {
    mockUseColorScheme.mockReturnValue(scheme);
    render(
      <Toast
        message="Payment failed"
        onDismiss={jest.fn()}
        variant="error"
        visible
      />
    );

    expect(screen.getByRole('alert')).toHaveStyle({
      backgroundColor: theme.foreground,
    });
    expect(screen.getByText('Payment failed')).toHaveStyle({
      color: theme.background,
    });
    expect(theme.background).not.toBe(theme.foreground);
  });
});
