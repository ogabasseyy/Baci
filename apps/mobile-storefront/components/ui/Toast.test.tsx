import { render } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';
import { Toast } from './Toast';

describe('bugfix: double screen reader announcement in RN toast', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('skips manual announceForAccessibility when OS is android', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const { getByRole } = render(
      <Toast message="Test toast" visible={true} onDismiss={() => {}} />
    );
    const toastView = getByRole('alert');
    expect(toastView.props.accessibilityLiveRegion).toBe('assertive');
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
  });

  it('invokes manual announceForAccessibility when OS is ios', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const { getByRole } = render(
      <Toast message="Test toast" visible={true} onDismiss={() => {}} />
    );
    const toastView = getByRole('alert');
    expect(toastView.props.accessibilityLiveRegion).toBe('assertive');
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Test toast'
    );
  });
});
