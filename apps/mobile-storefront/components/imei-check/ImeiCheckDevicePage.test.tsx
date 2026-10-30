import type { ImeiServiceTierKey } from '@baci/shared/imei';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { ImeiCheckDevicePage } from './ImeiCheckDevicePage';

let mockAvailableKeys: ImeiServiceTierKey[] | null = null;
let mockAvailabilityFailed = false;
const mockRetryAvailability = jest.fn();
jest.mock('./use-imei-runtime-availability', () => ({
  useImeiRuntimeAvailability: () => ({
    availableTierKeys: mockAvailableKeys,
    failed: mockAvailabilityFailed,
    loading: false,
    retry: mockRetryAvailability,
  }),
}));
beforeEach(() => {
  mockAvailableKeys = null;
  mockAvailabilityFailed = false;
  mockRetryAvailability.mockClear();
});

jest.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: () => null,
  default: () => null,
  __esModule: true,
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const baseProps = {
  colors: Colors.light,
  error: null as string | null,
  isLoading: false,
  isWalletError: false,
  isWalletLoading: false,
  walletBalance: 50_000,
  onVerify: jest.fn(),
  onTopUpWallet: jest.fn(),
};

describe('ImeiCheckDevicePage', () => {
  it('defaults to the recommended check for the given device', () => {
    render(<ImeiCheckDevicePage {...baseProps} device="laptop" />);

    // Mac's recommended flagship is the iCloud lock check.
    expect(screen.getByText('Mac iCloud Lock')).toBeTruthy();
    expect(screen.getByText(/Verify Now/)).toBeTruthy();
  });

  it('hides the brand filter for non-phone devices', () => {
    render(<ImeiCheckDevicePage {...baseProps} device="laptop" />);

    // Brand chips are phone-only; Samsung must not appear on a Mac page.
    expect(screen.queryByText('Samsung')).toBeNull();
  });

  it('calls onVerify with the selected tier and normalized IMEI', () => {
    const onVerify = jest.fn();
    render(
      <ImeiCheckDevicePage
        {...baseProps}
        device="smartphone"
        onVerify={onVerify}
      />
    );

    fireEvent.changeText(
      screen.getByPlaceholderText('Enter 15-digit IMEI'),
      '490154203237518'
    );
    fireEvent.press(screen.getByText('Verify Now - ₦1,500'));

    expect(onVerify).toHaveBeenCalledWith('full', '490154203237518');
  });

  it('renders the error banner when an error is present', () => {
    render(
      <ImeiCheckDevicePage
        {...baseProps}
        device="smartphone"
        error="Lookup failed"
      />
    );

    expect(screen.getByText('Lookup failed')).toBeTruthy();
  });

  it('replaces the CTA label with a spinner while a check is in flight', () => {
    render(
      <ImeiCheckDevicePage {...baseProps} device="smartphone" isLoading />
    );

    expect(screen.queryByText(/Verify Now/)).toBeNull();
  });
});

describe('runtime capability selection', () => {
  it('keeps provider-only checks hidden until advertised and clears a revoked selection', () => {
    const onVerify = jest.fn();
    const { rerender } = render(
      <ImeiCheckDevicePage
        {...baseProps}
        device="smartphone"
        onVerify={onVerify}
      />
    );
    fireEvent.press(screen.getByText('More checks'));
    expect(screen.queryByText('eSIM Compatibility')).toBeNull();
    mockAvailableKeys = ['full', 'esimCompatibility'];
    rerender(
      <ImeiCheckDevicePage
        {...baseProps}
        device="smartphone"
        onVerify={onVerify}
      />
    );
    fireEvent.press(screen.getByRole('radio', { name: /eSIM Compatibility/ }));
    fireEvent.changeText(
      screen.getByPlaceholderText('Enter 15-digit IMEI'),
      '490154203237518'
    );
    expect(screen.getByText('Verify Now - ₦700')).toBeTruthy();
    mockAvailableKeys = [];
    rerender(
      <ImeiCheckDevicePage
        {...baseProps}
        device="smartphone"
        onVerify={onVerify}
      />
    );
    expect(
      screen.queryByRole('radio', { name: /eSIM Compatibility/ })
    ).toBeNull();
    expect(screen.queryByText('Full Check')).toBeNull();
    expect(
      screen.getByText('No checks are available for this selection.')
    ).toBeTruthy();
    fireEvent.press(screen.getByText('Retry available checks'));
    expect(mockRetryAvailability).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByText('Choose a check'));
    expect(onVerify).not.toHaveBeenCalled();
  });
  it('offers retry after capability errors while keeping provider-only checks hidden', () => {
    mockAvailabilityFailed = true;
    render(<ImeiCheckDevicePage {...baseProps} device="smartphone" />);
    fireEvent.press(screen.getByText('More checks'));
    expect(
      screen.queryByRole('radio', { name: /eSIM Compatibility/ })
    ).toBeNull();
    expect(
      screen.getByText('Some services could not be checked.')
    ).toBeTruthy();
    fireEvent.press(
      screen.getByRole('button', { name: 'Retry available checks' })
    );
    expect(mockRetryAvailability).toHaveBeenCalledTimes(1);
  });
  it('shows a sole advertised advanced check directly without choosing it automatically', () => {
    mockAvailableKeys = ['esimCompatibility'];
    render(<ImeiCheckDevicePage {...baseProps} device="smartphone" />);
    expect(
      screen.getByRole('radio', { name: /eSIM Compatibility/ })
    ).toHaveAccessibilityState({ selected: false });
    expect(
      screen.queryByText('No checks are available for this selection.')
    ).toBeNull();
    expect(screen.getByText('Choose a check')).toBeTruthy();
  });
  it('filters an advertised Apple phone check after switching brand', () => {
    mockAvailableKeys = ['full', 'esimCompatibility'];
    render(<ImeiCheckDevicePage {...baseProps} device="smartphone" />);
    fireEvent.press(screen.getByText('More checks'));
    fireEvent.press(screen.getByRole('radio', { name: /eSIM Compatibility/ }));
    fireEvent.press(screen.getByText('Samsung'));
    expect(screen.queryByText('eSIM Compatibility')).toBeNull();
    expect(screen.queryByText('Verify Now - ₦700')).toBeNull();
  });
});
