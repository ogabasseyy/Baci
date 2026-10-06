import { render, screen } from '@testing-library/react-native';
import { SavingsProviderPreview } from './SavingsProviderPreview';

const originalDev = __DEV__;
afterEach(() => {
  Object.defineProperty(globalThis, '__DEV__', { value: originalDev });
});

it('shows the savings-scoped branding in the local preview', () => {
  Object.defineProperty(globalThis, '__DEV__', { value: true });
  render(<SavingsProviderPreview />);
  expect(
    screen.getByLabelText('Savings powered by PiggyVest. Design preview.')
  ).toBeOnTheScreen();
});

it('does not publish preview attribution in a release build', () => {
  Object.defineProperty(globalThis, '__DEV__', { value: false });
  render(<SavingsProviderPreview />);
  expect(screen.queryByText('Powered by')).toBeNull();
});
