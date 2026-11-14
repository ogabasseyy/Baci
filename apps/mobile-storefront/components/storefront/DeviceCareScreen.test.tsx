import { fireEvent, render, screen } from '@testing-library/react-native';
import { DeviceCareScreen } from './DeviceCareScreen';

const mockPush = jest.fn();
let mockMerchantSlug = 'ogabassey';
jest.mock('@/lib/config', () => ({
  CONFIG: {
    get MERCHANT_SLUG() {
      return mockMerchantSlug;
    },
  },
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  Redirect: ({ href }: { href: string }) => mockRedirect(href),
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

const mockRedirect = jest.fn((_href: string) => null);
it('redirects white-label shoppers to their help center', () => {
  mockMerchantSlug = 'another-store';
  render(
    <DeviceCareScreen
      title="Return Policy"
      heading="Ogabassey"
      intro="Ogabassey policy"
      sections={[]}
    />
  );
  expect(mockRedirect).toHaveBeenCalledWith('/faq');
  expect(screen.queryByText('Ogabassey policy')).toBeNull();
});
