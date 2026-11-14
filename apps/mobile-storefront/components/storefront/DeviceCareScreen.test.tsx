import { fireEvent, render, screen } from '@testing-library/react-native';
import { DeviceCareScreen } from './DeviceCareScreen';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  Stack: { Screen: () => null },
}));
jest.mock('@/hooks/use-merchant', () => ({ useMerchant: () => ({}) }));

it('shows the check timeline and opens related device care pages', () => {
  render(
    <DeviceCareScreen
      title="Return Policy"
      heading="Device care"
      intro="Get help with a fault"
      timelineCount={1}
      sections={[
        {
          title: 'Before delivery',
          body: 'We check your device.',
          icon: 'checkmark-outline',
        },
      ]}
      links={[{ label: 'Read the warranty', href: '/warranty' }]}
    />
  );
  expect(screen.getByText('Check 1 of 1')).toBeTruthy();
  fireEvent.press(screen.getByRole('link', { name: 'Read the warranty' }));
  expect(mockPush).toHaveBeenCalledWith('/warranty');
});
