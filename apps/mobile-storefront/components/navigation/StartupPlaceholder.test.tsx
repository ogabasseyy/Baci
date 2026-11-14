import { render, screen } from '@testing-library/react-native';
import { StartupPlaceholder } from './StartupPlaceholder';

it('keeps recovery progress hidden until startup times out', () => {
  render(<StartupPlaceholder showProgress={false} />);
  expect(screen.getByTestId('startup-placeholder')).toBeTruthy();
  expect(screen.queryByText('Getting things ready…')).toBeNull();
});

it('shows an accessible progress message after startup times out', () => {
  render(<StartupPlaceholder showProgress />);
  expect(
    screen.getByText('Getting things ready…').props.accessibilityLiveRegion
  ).toBe('polite');
});
