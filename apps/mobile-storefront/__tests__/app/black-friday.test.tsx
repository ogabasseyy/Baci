import { fireEvent, render, screen } from '@testing-library/react-native';
import BlackFridayScreen from '@/app/black-friday';

const mockRefetch = jest.fn();
let mockState: Record<string, unknown>;
jest.mock('@/hooks/use-black-friday', () => ({
  isOgabasseyApp: true,
  useBlackFriday: () => ({ ...mockState, refetch: mockRefetch }),
}));
jest.mock('@/components/storefront/StorefrontScreenShell', () => ({
  StorefrontScreenShell: ({ children }: { children: React.ReactNode }) =>
    children,
}));
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  Link: ({ href, children }: { href: unknown; children: React.ReactNode }) => {
    mockLinks.push(href);
    return children;
  },
}));
const mockLinks: unknown[] = [];

beforeEach(() => {
  mockState = {};
  mockLinks.length = 0;
  mockRefetch.mockClear();
});

it('shows loading and lets the shopper retry a failed lineup', () => {
  mockState = { isPending: true };
  const { rerender } = render(<BlackFridayScreen />);
  expect(screen.getByLabelText('Loading Black Friday offers')).toBeTruthy();
  mockState = { isError: true };
  rerender(<BlackFridayScreen />);
  fireEvent.press(screen.getByText('Try again'));
  expect(mockRefetch).toHaveBeenCalledTimes(1);
});

it('shows the empty state and links available offers to their product pages', () => {
  const { rerender } = render(<BlackFridayScreen />);
  expect(screen.getByText(/lineup will appear/)).toBeTruthy();
  mockState = {
    data: [{ id: 'one', slug: 'phone', name: 'Phone', price: '₦1' }],
  };
  rerender(<BlackFridayScreen />);
  expect(screen.getByText('Phone')).toBeTruthy();
  expect(mockLinks).toContainEqual({
    pathname: '/product/[slug]',
    params: { slug: 'phone' },
  });
});
