import { beforeAll, jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Alert, BackHandler } from 'react-native';
import type { AuthLoginResumeState } from '@/components/auth/login-resume-state';
import type { AuthState } from '@/stores/auth-store.types';

const mockAlert = jest.fn();
const mockBack = jest.fn();
const mockCanDismiss = jest.fn();
const mockDismiss = jest.fn();
const mockReplace = jest.fn();
const mockSetParams = jest.fn();
const mockUseLocalSearchParams = jest.fn(() => ({}));
const mockClearAuthLoginResumeState = jest.fn<() => Promise<void>>();
const mockGetAuthLoginResumeState =
  jest.fn<(returnTo: string | null) => Promise<AuthLoginResumeState | null>>();
const mockSaveAuthLoginResumeState =
  jest.fn<(state: AuthLoginResumeState) => Promise<void>>();
const mockSignInWithApple = jest.fn<AuthState['signInWithApple']>();
const mockSignInWithGoogle = jest.fn<AuthState['signInWithGoogle']>();
const mockSignInWithOtp = jest.fn<AuthState['signInWithOtp']>();
const mockSignInWithPassword = jest.fn<AuthState['signInWithPassword']>();
const mockVerifyOtp = jest.fn<AuthState['verifyOtp']>();
const mockBackHandlerRemove = jest.fn();
type HardwareBackPressHandler = () => boolean;
let hardwareBackPressHandler: HardwareBackPressHandler | null = null;
const mockDismissKeyboard = jest.fn();
const mockWithKeyboardDismiss = jest.fn(
  <T extends (...args: never[]) => unknown>(handler: T) => handler
);

const mockAuthState = {
  isInitialized: true,
  isLoading: false,
  signInWithApple: mockSignInWithApple,
  signInWithGoogle: mockSignInWithGoogle,
  signInWithOtp: mockSignInWithOtp,
  signInWithPassword: mockSignInWithPassword,
  user: null,
  verifyOtp: mockVerifyOtp,
};

jest.mock('expo-router', () => ({
  router: {
    back: mockBack,
    canDismiss: mockCanDismiss,
    dismiss: mockDismiss,
    replace: mockReplace,
    setParams: mockSetParams,
  },
  Stack: {
    Screen: () => null,
  },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: jest.fn(async () => false),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({
    children,
    ...props
  }: {
    children?: ReactNode;
    [key: string]: unknown;
  }) => {
    const { View: MockView } =
      jest.requireActual<typeof import('react-native')>('react-native');

    return (
      <MockView testID="login-safe-area" {...props}>
        {children}
      </MockView>
    );
  },
}));

jest.mock('@/components/icons/GoogleLogo', () => ({
  GoogleLogo: () => null,
}));

jest.mock('@/components/ui/Logo', () => ({
  Logo: () => null,
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/hooks/use-keyboard', () => ({
  TextContentTypes: {
    emailAddress: 'emailAddress',
    oneTimeCode: 'oneTimeCode',
    password: 'password',
  },
  useKeyboard: () => ({
    dismissKeyboard: mockDismissKeyboard,
    withKeyboardDismiss: mockWithKeyboardDismiss,
  }),
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }),
}));

jest.mock('@/components/auth/login-resume-state', () => ({
  clearAuthLoginResumeState: () => mockClearAuthLoginResumeState(),
  getAuthLoginResumeState: (returnTo: string | null) =>
    mockGetAuthLoginResumeState(returnTo),
  saveAuthLoginResumeState: (state: AuthLoginResumeState) =>
    mockSaveAuthLoginResumeState(state),
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: typeof mockAuthState) => unknown) =>
    selector(mockAuthState),
}));

let LoginScreen: typeof import('@/app/auth/login').default;

// Import LoginScreen after jest mocks are registered because the route module
// reads router/auth hooks during module evaluation.
beforeAll(async () => {
  LoginScreen = (await import('@/app/auth/login')).default;
});

describe('LoginScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    hardwareBackPressHandler = null;
    jest.spyOn(Alert, 'alert').mockImplementation(mockAlert);
    jest
      .spyOn(BackHandler, 'addEventListener')
      .mockImplementation((_eventName, handler) => {
        hardwareBackPressHandler =
          handler as unknown as HardwareBackPressHandler;
        return {
          remove: mockBackHandlerRemove,
        } as ReturnType<typeof BackHandler.addEventListener>;
      });
    mockAuthState.isInitialized = true;
    mockAuthState.isLoading = false;
    mockAuthState.user = null;
    mockCanDismiss.mockReturnValue(false);
    mockSignInWithApple.mockResolvedValue({ success: true });
    mockSignInWithGoogle.mockResolvedValue({ success: true });
    mockSignInWithOtp.mockResolvedValue({ success: true });
    mockSignInWithPassword.mockResolvedValue({ success: true });
    mockVerifyOtp.mockResolvedValue({ success: true });
    mockClearAuthLoginResumeState.mockResolvedValue(undefined);
    mockGetAuthLoginResumeState.mockResolvedValue(null);
    mockSaveAuthLoginResumeState.mockResolvedValue(undefined);
    mockUseLocalSearchParams.mockReturnValue({});
  });

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

  it('shows the masked receipt claim hint from the return path token without prefilling the email input', async () => {
    // The login-email route returns only the masked hint; a masked value is
    // not a sendable address, so it is shown as guidance text while the OTP
    // email input stays empty.
    const originalFetch = global.fetch;
    const fetchMock = jest.fn(async () => ({
      json: async () => ({ emailHint: 's***@example.com' }),
      ok: true,
    })) as unknown as typeof fetch;
    global.fetch = fetchMock;
    mockUseLocalSearchParams.mockReturnValue({
      returnTo: '/receipts/claim/token_123',
    });

    try {
      render(<LoginScreen />);

      expect(
        await screen.findByText(/This receipt was sent to/)
      ).toHaveTextContent(/s\*\*\*@example\.com/);
      expect(screen.getByPlaceholderText('john@example.com')).toHaveProp(
        'value',
        ''
      );
      expect(fetchMock).toHaveBeenCalledWith(
        'https://usebaci.com/api/storefront/receipts/claims/token_123/login-email',
        { headers: { accept: 'application/json' } }
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('ignores a full email address from the claim login-email route', async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn(async () => ({
      json: async () => ({ emailHint: 'Shopper@Example.COM' }),
      ok: true,
    })) as unknown as typeof fetch;
    global.fetch = fetchMock;
    mockUseLocalSearchParams.mockReturnValue({
      returnTo: '/receipts/claim/token_123',
    });

    try {
      render(<LoginScreen />);

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          'https://usebaci.com/api/storefront/receipts/claims/token_123/login-email',
          { headers: { accept: 'application/json' } }
        );
      });
      expect(
        screen.queryByText(/This receipt was sent to/)
      ).not.toBeOnTheScreen();
      expect(screen.getByPlaceholderText('john@example.com')).toHaveProp(
        'value',
        ''
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
      handledBackPress = hardwareBackPressHandler?.() === true;
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

  it('surfaces OTP send failures without advancing to verification', async () => {
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
        'Email service unavailable'
      );
    });
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

  describe('bugfix: "Use password instead" only relabelled the button', () => {
    it('opens the password field straight away when the email is valid', async () => {
      render(<LoginScreen />);

      fireEvent.changeText(
        screen.getByPlaceholderText('john@example.com'),
        '  Shopper@Example.com '
      );
      fireEvent.press(screen.getByText('Use password instead'));

      expect(
        await screen.findByText(
          'Sign in with your password for shopper@example.com'
        )
      ).toBeOnTheScreen();
      expect(screen.getByPlaceholderText('••••••••')).toBeOnTheScreen();
      expect(mockSignInWithOtp).not.toHaveBeenCalled();
    });

    it('stays on the email step without an error when no valid email is typed yet', async () => {
      render(<LoginScreen />);

      fireEvent.press(screen.getByText('Use password instead'));

      expect(screen.getByText('Continue with Password')).toBeOnTheScreen();
      expect(screen.queryByPlaceholderText('••••••••')).toBeNull();
      // The email error is plain text, so assert on the message itself.
      // Imported here, not at the top: the helpers load expo-router, which
      // must see the mocks registered above.
      const { validateLoginEmailInput } = await import(
        '@/components/auth/login-screen-controller.helpers'
      );
      const emailRequired = validateLoginEmailInput('').error as string;
      expect(emailRequired).toBeTruthy();
      expect(screen.queryByText(emailRequired)).toBeNull();
      expect(
        screen.getByText('Use verification code instead')
      ).toBeOnTheScreen();

      // Positive control: the same message does appear once the shopper
      // actually tries to continue.
      fireEvent.press(screen.getByText('Continue with Password'));
      expect(screen.getByText(emailRequired)).toBeOnTheScreen();
    });

    it('stays on the email step, shows no error and sends no code for a malformed email', async () => {
      render(<LoginScreen />);

      fireEvent.changeText(
        screen.getByPlaceholderText('john@example.com'),
        'foo'
      );
      fireEvent.press(screen.getByText('Use password instead'));

      expect(screen.getByText('Continue with Password')).toBeOnTheScreen();
      expect(screen.queryByPlaceholderText('••••••••')).toBeNull();
      const { validateLoginEmailInput } = await import(
        '@/components/auth/login-screen-controller.helpers'
      );
      const invalidEmail = validateLoginEmailInput('foo').error as string;
      expect(invalidEmail).toBeTruthy();
      expect(screen.queryByText(invalidEmail)).toBeNull();
      expect(mockSignInWithOtp).not.toHaveBeenCalled();
    });

    it('dismisses the keyboard only when the toggle opens the password step', () => {
      render(<LoginScreen />);
      const emailInput = screen.getByPlaceholderText('john@example.com');

      fireEvent.changeText(emailInput, 'foo');
      fireEvent.press(screen.getByText('Use password instead'));
      expect(mockDismissKeyboard).not.toHaveBeenCalled();

      fireEvent.press(screen.getByText('Use verification code instead'));
      fireEvent.changeText(emailInput, 'shopper@example.com');
      fireEvent.press(screen.getByText('Use password instead'));

      expect(mockDismissKeyboard).toHaveBeenCalledTimes(1);
      expect(screen.getByPlaceholderText('••••••••')).toBeOnTheScreen();
    });

    it('clears a stale email error when toggling back to the code method', async () => {
      render(<LoginScreen />);
      const { validateLoginEmailInput } = await import(
        '@/components/auth/login-screen-controller.helpers'
      );
      const emailRequired = validateLoginEmailInput('').error;
      if (!emailRequired) throw new Error('expected an email-required error');

      fireEvent.press(screen.getByText('Use password instead'));
      fireEvent.press(screen.getByText('Continue with Password'));
      expect(screen.getByText(emailRequired)).toBeOnTheScreen();

      fireEvent.press(screen.getByText('Use verification code instead'));

      expect(screen.queryByText(emailRequired)).toBeNull();
    });

    it('switches back to the code method from the email step', () => {
      render(<LoginScreen />);

      fireEvent.press(screen.getByText('Use password instead'));
      fireEvent.press(screen.getByText('Use verification code instead'));

      expect(screen.getByText('Continue with Code')).toBeOnTheScreen();
    });
  });
});
