import { act, render } from '@testing-library/react-native';
import AuthCallback from '@/app/auth/callback';

const mockReplace = jest.fn();
const mockGetSession = jest.fn();
let mockReturnTo: string | string[] | undefined;

jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
  useLocalSearchParams: () => ({ returnTo: mockReturnTo }),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: () => mockGetSession() } },
}));
jest.mock('@/components/storefront/StorefrontScreenShell', () => ({
  StorefrontScreenShell: ({ children }: { children: React.ReactNode }) =>
    children,
}));
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ colors: { background: '#fff' } }),
}));

beforeEach(() => {
  jest.useFakeTimers();
  mockReplace.mockClear();
  mockGetSession.mockResolvedValue({ data: { session: {} } });
});
afterEach(() => jest.useRealTimers());

it.each([
  { returnTo: '/(tabs)/account', target: '/(tabs)/account' },
  { returnTo: '/account', target: '/(tabs)/account' },
  { returnTo: '/wallet', target: '/(tabs)/wallet' },
  { returnTo: encodeURIComponent('/(tabs)/wallet'), target: '/(tabs)/wallet' },
  { returnTo: '/auth/login', target: '/' },
  { returnTo: '/account%', target: '/' },
  { returnTo: ['/account', '/wallet'], target: '/' },
])('routes an authenticated callback to $target', async ({
  returnTo,
  target,
}) => {
  mockReturnTo = returnTo;
  render(<AuthCallback />);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(500);
  });
  expect(mockReplace).toHaveBeenCalledWith(target);
});
