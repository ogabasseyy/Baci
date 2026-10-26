import { beforeAll } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { loginScreenTestHarness } from './login.test-utils';

const {
  getHardwareBackPressHandler,
  mockAlert,
  mockBack,
  mockClearAuthLoginResumeState,
  mockGetAuthLoginResumeState,
  mockSaveAuthLoginResumeState,
  mockSetParams,
  mockSignInWithOtp,
  mockUseLocalSearchParams,
  mockWithKeyboardDismiss,
} = loginScreenTestHarness;

let LoginScreen: typeof import('@/app/auth/login').default;

// Import LoginScreen after jest mocks are registered because the route module
// reads router/auth hooks during module evaluation.
beforeAll(async () => {
  LoginScreen = await loginScreenTestHarness.loadLoginScreen();
});

describe('LoginScreen', () => {
  beforeEach(loginScreenTestHarness.reset);

  it('renders the email login step inside safe-area and keyboard-aware wrappers', () => {
    render(<LoginScreen />);

    expect(screen.getByTestId('login-safe-area')).toBeOnTheScreen();
    expect(screen.getByTestId('keyboard-aware-scroll-view')).toHaveProp(
      'keyboardDismissMode',
      'on-drag'
    );
    expect(screen.getByTestId('keyboard-aware-scroll-view')).toHaveProp(
      'keyboardShouldPersistTaps',
      'handled'
    );
    expect(screen.getByText('Welcome Back')).toBeOnTheScreen();
    expect(screen.getByPlaceholderText('john@example.com')).toBeOnTheScreen();
    expect(screen.getByText('Continue with Code')).toBeOnTheScreen();
    expect(screen.getByText('Google')).toBeOnTheScreen();
    expect(screen.getByText('Apple')).toBeOnTheScreen();
  });

  it('prefills a valid email query parameter', () => {
    mockUseLocalSearchParams.mockReturnValue({
      email: '  Shopper@Example.COM  ',
    });

    render(<LoginScreen />);

    expect(screen.getByPlaceholderText('john@example.com')).toHaveProp(
      'value',
      'shopper@example.com'
    );
  });

  it('ignores invalid email query parameters', () => {
    mockUseLocalSearchParams.mockReturnValue({
      email: 'https://evil.example',
    });

    render(<LoginScreen />);

    expect(screen.getByPlaceholderText('john@example.com')).toHaveProp(
      'value',
      ''
    );
  });

  it('prefills receipt claim login email from the return path token', async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn(async () => ({
      json: async () => ({ emailHint: '  Shopper@Example.COM  ' }),
      ok: true,
    })) as unknown as typeof fetch;
    global.fetch = fetchMock;
    mockUseLocalSearchParams.mockReturnValue({
      returnTo: '/receipts/claim/token_123',
    });

    try {
      render(<LoginScreen />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('john@example.com')).toHaveProp(
          'value',
          'shopper@example.com'
        );
      });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://usebaci.com/api/storefront/receipts/claims/token_123/login-email',
        { headers: { accept: 'application/json' } }
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('submits a normalized email through the OTP auth flow', async () => {
    render(<LoginScreen />);

    fireEvent.changeText(
      screen.getByPlaceholderText('john@example.com'),
      'Shopper@Example.COM '
    );
    fireEvent.press(screen.getByText('Continue with Code'));

    await waitFor(() => {
      expect(mockSignInWithOtp).toHaveBeenCalledWith('shopper@example.com');
    });
    expect(mockSaveAuthLoginResumeState).toHaveBeenCalledWith({
      email: 'shopper@example.com',
      returnTo: null,
      step: 'otp',
    });
    expect(mockSetParams).toHaveBeenCalledWith({ mode: 'otp' });
    expect(await screen.findByText('Verify Your Email')).toBeOnTheScreen();
    expect(mockWithKeyboardDismiss).toHaveBeenCalled();
  });

  it('clears pending OTP resume state on Android hardware back', async () => {
    render(<LoginScreen />);

    fireEvent.changeText(
      screen.getByPlaceholderText('john@example.com'),
      'shopper@example.com'
    );
    fireEvent.press(screen.getByText('Continue with Code'));

    expect(await screen.findByText('Verify Your Email')).toBeOnTheScreen();

    let handledBackPress = false;
    act(() => {
      handledBackPress = getHardwareBackPressHandler()?.() === true;
    });

    expect(handledBackPress).toBe(true);
    expect(mockClearAuthLoginResumeState).toHaveBeenCalled();
    expect(mockSetParams).toHaveBeenCalledWith({ mode: 'email' });
    expect(screen.getByText('Welcome Back')).toBeOnTheScreen();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('restores the pending OTP step from secure resume state', async () => {
    mockUseLocalSearchParams.mockReturnValue({
      mode: 'otp',
      returnTo: '/checkout',
    });
    mockGetAuthLoginResumeState.mockResolvedValueOnce({
      email: 'shopper@example.com',
      returnTo: '/checkout',
      step: 'otp',
    });

    render(<LoginScreen />);

    await waitFor(() => {
      expect(mockGetAuthLoginResumeState).toHaveBeenCalledWith('/checkout');
    });
    expect(await screen.findByText('Verify Your Email')).toBeOnTheScreen();
    expect(screen.getByText('shopper@example.com')).toBeOnTheScreen();
  });

  it('safely presents OTP send failures without saving or advancing verification', async () => {
    mockSignInWithOtp.mockResolvedValueOnce({
      error: 'Email service unavailable',
      success: false,
    });
    render(<LoginScreen />);

    fireEvent.changeText(
      screen.getByPlaceholderText('john@example.com'),
      'shopper@example.com'
    );
    fireEvent.press(screen.getByText('Continue with Code'));

    await waitFor(() => {
      expect(mockAlert).toHaveBeenCalledWith(
        'Error',
        "We couldn't sign you in. Please try again."
      );
    });
    expect(mockSignInWithOtp).toHaveBeenCalledWith('shopper@example.com');
    expect(mockSaveAuthLoginResumeState).not.toHaveBeenCalled();
    expect(mockSetParams).not.toHaveBeenCalledWith({ mode: 'otp' });
    expect(screen.getByText('Welcome Back')).toBeOnTheScreen();
    expect(screen.queryByText('Verify Your Email')).toBeNull();
  });

  it('announces and toggles password visibility from the password step', async () => {
    render(<LoginScreen />);

    fireEvent.changeText(
      screen.getByPlaceholderText('john@example.com'),
      'shopper@example.com'
    );
    fireEvent.press(screen.getByText('Use password instead'));

    expect(
      await screen.findByText(
        'Sign in with your password for shopper@example.com'
      )
    ).toBeOnTheScreen();

    const passwordInput = screen.getByPlaceholderText('••••••••');
    expect(passwordInput).toHaveProp('secureTextEntry', true);

    fireEvent.press(screen.getByRole('button', { name: 'Show password' }));

    expect(
      screen.getByRole('button', { name: 'Hide password' })
    ).toBeOnTheScreen();
    expect(passwordInput).toHaveProp('secureTextEntry', false);
  });
});
