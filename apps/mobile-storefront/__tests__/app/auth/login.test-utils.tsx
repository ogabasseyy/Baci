import { jest } from '@jest/globals';
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

function reset() {
  jest.clearAllMocks();
  hardwareBackPressHandler = null;
  jest.spyOn(Alert, 'alert').mockImplementation(mockAlert);
  jest
    .spyOn(BackHandler, 'addEventListener')
    .mockImplementation((_eventName, handler) => {
      hardwareBackPressHandler = handler as unknown as HardwareBackPressHandler;
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
}

export const loginScreenTestHarness = {
  loadLoginScreen: async () => (await import('@/app/auth/login')).default,
  reset,
  getHardwareBackPressHandler: () => hardwareBackPressHandler,
  mockAlert,
  mockBack,
  mockClearAuthLoginResumeState,
  mockGetAuthLoginResumeState,
  mockSaveAuthLoginResumeState,
  mockSetParams,
  mockSignInWithOtp,
  mockUseLocalSearchParams,
  mockWithKeyboardDismiss,
};
