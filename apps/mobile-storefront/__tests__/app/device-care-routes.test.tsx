import {
  OGABASSEY_ASSURANCE_HELP,
  OGABASSEY_QUALITY_CHECKS,
  OGABASSEY_RETURN_SHIPPING,
  OGABASSEY_WARRANTY_DETAILS,
} from '@baci/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import DeviceProtectionScreen from '@/app/device-protection';
import ReturnPolicyScreen from '@/app/returns';
import WarrantyScreen from '@/app/warranty';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  Stack: { Screen: () => null },
}));
jest.mock('@/lib/config', () => ({ CONFIG: { MERCHANT_SLUG: 'ogabassey' } }));
jest.mock('@/hooks/use-merchant', () => ({ useMerchant: () => ({}) }));

beforeEach(() => mockPush.mockClear());

it('renders the return policy timeline and opens assurance and warranty', () => {
  render(<ReturnPolicyScreen />);
  for (const [index, check] of OGABASSEY_QUALITY_CHECKS.entries()) {
    expect(screen.getByText(check.title)).toBeOnTheScreen();
    expect(
      screen.getByText(
        `Check ${index + 1} of ${OGABASSEY_QUALITY_CHECKS.length}`
      )
    ).toBeOnTheScreen();
  }
  expect(screen.getByText(OGABASSEY_RETURN_SHIPPING)).toBeOnTheScreen();
  fireEvent.press(
    screen.getByRole('link', { name: 'Explore Ogabassey Assurance' })
  );
  fireEvent.press(screen.getByRole('link', { name: 'Read the warranty' }));
  expect(mockPush.mock.calls).toEqual([['/device-protection'], ['/warranty']]);
});

it('renders warranty coverage and links back to the return policy', () => {
  render(<WarrantyScreen />);
  expect(screen.getByText(OGABASSEY_WARRANTY_DETAILS)).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('link', { name: 'Return Policy' }));
  expect(mockPush).toHaveBeenCalledWith('/returns');
});

it('renders assurance claims and links to cart and warranty', () => {
  render(<DeviceProtectionScreen />);
  expect(screen.getByText(OGABASSEY_ASSURANCE_HELP)).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('link', { name: 'View cart' }));
  fireEvent.press(screen.getByRole('link', { name: 'Read the warranty' }));
  expect(mockPush.mock.calls).toEqual([['/cart'], ['/warranty']]);
});
