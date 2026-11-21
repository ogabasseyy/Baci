import { render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Platform, useColorScheme } from 'react-native';
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
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

  it('announces visible toasts imperatively on iOS including persistent toasts (duration=0)', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const announceSpy = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(jest.fn());

    render(
      <Toast
        duration={0}
        message="Address saved"
        onDismiss={jest.fn()}
        variant="success"
        visible
      />
    );

    expect(announceSpy).toHaveBeenCalledTimes(1);
    expect(announceSpy).toHaveBeenCalledWith('Address saved');
  });

  it('does not announce imperatively on iOS when hidden or whitespace-only', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const announceSpy = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(jest.fn());

    render(
      <Toast
        message="Hidden toast"
        onDismiss={jest.fn()}
        variant="info"
        visible={false}
      />
    );
    render(
      <Toast message="   " onDismiss={jest.fn()} variant="info" visible />
    );

    expect(announceSpy).not.toHaveBeenCalled();
  });

  it('uses declarative live regions without imperative announcement on Android', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const announceSpy = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(jest.fn());

    const { rerender } = render(
      <Toast
        message="Payment failed"
        onDismiss={jest.fn()}
        variant="error"
        visible
      />
    );

    expect(screen.getByRole('alert').props.accessibilityLiveRegion).toBe(
      'assertive'
    );
    expect(announceSpy).not.toHaveBeenCalled();

    rerender(
      <Toast
        duration={0}
        message="Saved to wishlist"
        onDismiss={jest.fn()}
        variant="success"
        visible
      />
    );

    expect(screen.getByRole('alert').props.accessibilityLiveRegion).toBe(
      'polite'
    );
    expect(announceSpy).not.toHaveBeenCalled();
  });

  it('relies on declarative live regions without imperative announcement on web', () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const announceSpy = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(jest.fn());

    render(
      <Toast
        message="Order placed"
        onDismiss={jest.fn()}
        variant="info"
        visible
      />
    );

    expect(screen.getByRole('alert').props.accessibilityLiveRegion).toBe(
      'polite'
    );
    expect(announceSpy).not.toHaveBeenCalled();
  });

  it('restarts the dismissal timer when the toast message changes while visible', () => {
    jest.useFakeTimers();
    try {
      const onDismiss = jest.fn();
      const { rerender } = render(
        <Toast
          duration={3000}
          message="First message"
          onDismiss={onDismiss}
          visible
        />
      );

      jest.advanceTimersByTime(2900);
      rerender(
        <Toast
          duration={3000}
          message="Second message"
          onDismiss={onDismiss}
          visible
        />
      );

      jest.advanceTimersByTime(100);
      expect(onDismiss).not.toHaveBeenCalled();

      jest.advanceTimersByTime(2900);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
