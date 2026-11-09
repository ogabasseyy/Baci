import { render } from '@testing-library/react-native';

import { Toast } from './Toast';

describe('Toast', () => {
  it('renders with accessibilityRole="alert" and accessibilityLiveRegion="assertive"', () => {
    const { getByRole } = render(
      <Toast message="Test toast" visible={true} onDismiss={() => {}} />
    );
    const toastView = getByRole('alert');
    expect(toastView.props.accessibilityLiveRegion).toBe('assertive');
  });
});
