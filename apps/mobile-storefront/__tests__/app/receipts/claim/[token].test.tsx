import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import ReceiptClaimScreen from '@/app/receipts/claim/[token]';

type ShellProps = {
  children?: ReactNode;
  edges?: readonly string[];
};

type MockFetchResponse = Pick<Response, 'json' | 'ok'> & {
  status?: number;
};

const mockGetSession =
  jest.fn<() => Promise<{ access_token: string } | null>>();
const mockRedirect = jest.fn(({ href }: { href: string }) => (
  <View testID="claim-redirect" accessibilityLabel={href} />
));
const mockReplace = jest.fn();
const mockUseLocalSearchParams = jest.fn();
const mockUseRequireAuth = jest.fn();
const mockInvalidateQueries =
  jest.fn<(filters: { queryKey: readonly string[] }) => Promise<void>>();
const mockQueryClient = { invalidateQueries: mockInvalidateQueries };
const mockFetch =
  jest.fn<
    (input: RequestInfo | URL, init?: RequestInit) => Promise<MockFetchResponse>
  >();
const mockStorefrontScreenShell = jest.fn(({ children }: ShellProps) => (
  <View testID="claim-shell">{children}</View>
));

jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => mockRedirect({ href }),
  router: {
    replace: (...args: unknown[]) => mockReplace(...args),
  },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

jest.mock('@/components/storefront/StorefrontScreenShell', () => ({
  StorefrontScreenShell: ({ children, ...props }: ShellProps) =>
    mockStorefrontScreenShell({ children, ...props }),
}));

jest.mock('@/hooks/use-auth-guard', () => ({
  useRequireAuth: () => mockUseRequireAuth(),
}));

jest.mock('@/lib/supabase', () => ({
  getSession: () => mockGetSession(),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => mockQueryClient,
}));

jest.mock('@/env', () => ({
  EXPO_PUBLIC_API_URL: 'https://ogabassey.com',
}));

jest.mock('@react-native-vector-icons/ionicons', () => ({
  __esModule: true,
  default: ({ name }: { name: string }) => {
    const { Text } =
      jest.requireActual<typeof import('react-native')>('react-native');

    return <Text>{name}</Text>;
  },
}));

describe('ReceiptClaimScreen', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalSearchParams.mockReturnValue({ token: 'claim-token' });
    mockUseRequireAuth.mockReturnValue({
      isLoading: false,
      redirectTo: null,
    });
    mockGetSession.mockResolvedValue({
      access_token: 'access-token',
    });
    mockInvalidateQueries.mockResolvedValue(undefined);
    mockFetch.mockResolvedValue({
      json: async () => ({ success: true, redirectPath: '/receipts' }),
      ok: true,
    });
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('preserves the claim route and masked email hint when unauthenticated customers are sent to login', () => {
    // The claim link and the login-email route carry only the masked hint
    // (for example `b***@yahoo.co.uk`); full addresses must never ride the
    // login redirect.
    mockUseLocalSearchParams.mockReturnValue({
      email: '  b***@yahoo.co.uk  ',
      token: 'claim-token',
    });
    mockUseRequireAuth.mockReturnValue({
      isLoading: false,
      redirectTo: '/auth/login?returnTo=%2Freceipts%2Fclaim%2Fclaim-token',
    });

    render(<ReceiptClaimScreen />);

    expect(mockRedirect).toHaveBeenCalledWith({
      href: '/auth/login?returnTo=%2Freceipts%2Fclaim%2Fclaim-token&email=b***%40yahoo.co.uk',
    });
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('loads the masked login email hint from the claim token before redirecting unauthenticated customers', async () => {
    mockUseRequireAuth.mockReturnValue({
      isLoading: false,
      redirectTo: '/auth/login?returnTo=%2Freceipts%2Fclaim%2Fclaim-token',
    });
    mockFetch.mockResolvedValue({
      json: async () => ({ emailHint: 'b***@yahoo.co.uk' }),
      ok: true,
    });

    render(<ReceiptClaimScreen />);

    expect(screen.getByText('Preparing sign-in...')).toBeOnTheScreen();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        'https://ogabassey.com/api/storefront/receipts/claims/claim-token/login-email?source=app',
        expect.objectContaining({ method: 'GET' })
      );
      expect(mockRedirect).toHaveBeenCalledWith({
        href: '/auth/login?returnTo=%2Freceipts%2Fclaim%2Fclaim-token&email=b***%40yahoo.co.uk',
      });
    });
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it('drops a full email address from the claim route instead of leaking it into the login redirect', async () => {
    mockUseLocalSearchParams.mockReturnValue({
      email: '  BasseyBJohn@Yahoo.CO.UK  ',
      token: 'claim-token',
    });
    mockUseRequireAuth.mockReturnValue({
      isLoading: false,
      redirectTo: '/auth/login?returnTo=%2Freceipts%2Fclaim%2Fclaim-token',
    });

    render(<ReceiptClaimScreen />);

    expect(screen.getByText('Preparing sign-in...')).toBeOnTheScreen();

    await waitFor(() => {
      expect(mockRedirect).toHaveBeenCalledWith({
        href: '/auth/login?returnTo=%2Freceipts%2Fclaim%2Fclaim-token',
      });
    });
    expect(mockRedirect).not.toHaveBeenCalledWith(
      expect.objectContaining({ href: expect.stringContaining('email=') })
    );
  });

  it('redeems the claim with the current bearer session and opens the API redirect path', async () => {
    render(<ReceiptClaimScreen />);

    expect(
      screen.getByText(
        'We are linking it to your signed-in account, then your receipts panel will open automatically.'
      )
    ).toBeOnTheScreen();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        'https://ogabassey.com/api/storefront/receipts/claims/claim-token',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer access-token',
          }),
          method: 'POST',
        })
      );
    });

    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['receipts'],
      });
      expect(mockReplace).toHaveBeenCalledWith('/receipts?receiptClaimed=1');
      expect(mockInvalidateQueries.mock.invocationCallOrder[0]).toBeLessThan(
        mockReplace.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
      );
    });
  });

  it('honors an internal API redirect path after a successful claim', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({
        success: true,
        redirectPath: '/receipts?claimed=1',
      }),
      ok: true,
    });

    render(<ReceiptClaimScreen />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        '/receipts?claimed=1&receiptClaimed=1'
      );
    });
  });

  it('replaces an existing receipt claim marker in the redirect path', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({
        success: true,
        redirectPath: '/receipts?receiptClaimed=0&claimed=1',
      }),
      ok: true,
    });

    render(<ReceiptClaimScreen />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        '/receipts?receiptClaimed=1&claimed=1'
      );
    });
  });

  it('preserves redirect URL fragments when marking the receipt claim success', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({
        success: true,
        redirectPath: '/receipts#latest',
      }),
      ok: true,
    });

    render(<ReceiptClaimScreen />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        '/receipts?receiptClaimed=1#latest'
      );
    });
  });

  it('falls back to receipts when the API redirect path is missing or unsafe', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({ success: true, redirectPath: 'https://evil.test' }),
      ok: true,
    });

    render(<ReceiptClaimScreen />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/receipts?receiptClaimed=1');
    });
  });

  it('shows a retryable error when the claim cannot be redeemed', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({ error: 'This receipt link has expired.' }),
      ok: false,
      status: 410,
    });

    render(<ReceiptClaimScreen />);

    expect(
      await screen.findByText('This receipt link has expired.')
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
  });

  it('retries the claim request when the retry button is pressed', async () => {
    mockFetch
      .mockResolvedValueOnce({
        json: async () => ({ error: 'Temporary failure' }),
        ok: false,
        status: 500,
      })
      .mockResolvedValueOnce({
        json: async () => ({ success: true }),
        ok: true,
      });

    render(<ReceiptClaimScreen />);

    fireEvent.press(await screen.findByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
    expect(mockReplace).toHaveBeenCalledWith('/receipts?receiptClaimed=1');
  });
});
