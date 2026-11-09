import { render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';
import { Toast } from './Toast';

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');

  // mock AccessibilityInfo
  RN.AccessibilityInfo.announceForAccessibility = jest.fn();

  return RN;
});

describe('bugfix: double screen reader announcement in RN toast', () => {
  let originalOS: typeof Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    originalOS = Platform.OS;
  });

  afterEach(() => {
    Platform.OS = originalOS;
  });

  it('skips manual announceForAccessibility when OS is android', async () => {
    Platform.OS = 'android';
    const { getByRole } = render(
      <Toast message="Test toast" visible={true} onDismiss={() => {}} />
    );
    const toastView = getByRole('alert');
    expect(toastView.props.accessibilityLiveRegion).toBe('assertive');

    await waitFor(() => {
      expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
    });
  });

  it('invokes manual announceForAccessibility when OS is ios', async () => {
    Platform.OS = 'ios';
    const { getByRole } = render(
      <Toast message="Test toast" visible={true} onDismiss={() => {}} />
    );
    const toastView = getByRole('alert');
    expect(toastView.props.accessibilityLiveRegion).toBe('assertive');

    await waitFor(() => {
      expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
        'Test toast'
      );
    });
  });
});
