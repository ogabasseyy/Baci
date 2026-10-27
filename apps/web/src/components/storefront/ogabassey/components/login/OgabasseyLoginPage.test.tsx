import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OgabasseyLoginPage } from './OgabasseyLoginPage';

// Mock next/navigation
const mockPush = vi.fn();
const mockRouter = { push: mockPush };
const mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => mockRouter),
  useSearchParams: vi.fn(() => mockSearchParams),
}));

// Mock @/hooks/use-merchant
const mockUseMerchant = vi.fn();
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: () => mockUseMerchant(),
}));

// Mock @/contexts/customer-auth-context
const mockUseCustomerAuth = vi.fn();
vi.mock('@/contexts/customer-auth-context', () => ({
  useCustomerAuth: () => mockUseCustomerAuth(),
}));

// Mock @/lib/routes
vi.mock('@/lib/routes', () => ({
  asRoute: vi.fn((path) => path || '/'),
}));

// Mock ./hooks
const mockUseOgabasseyLogin = vi.fn();
vi.mock('./hooks', () => ({
  useOgabasseyLogin: (params: unknown) => mockUseOgabasseyLogin(params),
}));

// Mock ./utils
vi.mock('./utils', () => ({
  sanitizeRedirect: vi.fn((redirect) => {
    // Mimic actual implementation behavior
    if (!redirect) return '/account';
    if (
      !redirect.startsWith('/') ||
      redirect.startsWith('//') ||
      redirect.includes(':')
    ) {
      return '/account';
    }
    return redirect;
  }),
}));

// Mock ./components
vi.mock('./components', () => ({
  LoadingScreen: vi.fn(({ message }: { message: string }) => (
    <div data-testid="loading-screen">{message}</div>
  )),
  LoginHeader: vi.fn(() => <header data-testid="login-header">Header</header>),
  EmailForm: vi.fn(() => <div data-testid="email-form">EmailForm</div>),
  OtpVerificationForm: vi.fn(() => (
    <div data-testid="otp-form">OtpVerificationForm</div>
  )),
  LoginFooter: vi.fn(() => <footer data-testid="login-footer">Footer</footer>),
}));

// Mock ../Logo
vi.mock('../Logo', () => ({
  Logo: vi.fn(() => <div data-testid="ogabassey-logo">Logo</div>),
}));

describe('OgabasseyLoginPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    mockUseMerchant.mockReturnValue({ loading: false });
    mockUseCustomerAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    });
    mockUseOgabasseyLogin.mockReturnValue({
      email: '',
      code: ['', '', '', '', '', ''],
      error: null,
      isSending: false,
      isVerifying: false,
      isGoogleLoading: false,
      isAppleLoading: false,
      isCodeSent: false,
      sentToEmail: '',
      setEmail: vi.fn(),
      handleSendCode: vi.fn(),
      handleCodeChange: vi.fn(),
      handleKeyDown: vi.fn(),
      handlePaste: vi.fn(),
      handleResendCode: vi.fn(),
      handleChangeEmail: vi.fn(),
      handleGoogleSignIn: vi.fn(),
      handleAppleSignIn: vi.fn(),
      codeInputRefs: { current: [] },
    });
    mockSearchParams.get = vi.fn(() => null);
  });

  describe('Loading states', () => {
    it('shows LoadingScreen with merchant message when merchantLoading is true', () => {
      // Arrange
      mockUseMerchant.mockReturnValue({ loading: true });
      mockUseCustomerAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
      });

      // Act
      render(<OgabasseyLoginPage />);

      // Assert
      expect(screen.getByTestId('loading-screen')).toBeInTheDocument();
      expect(screen.getByText('Loading store data...')).toBeInTheDocument();
      expect(screen.queryByTestId('login-header')).not.toBeInTheDocument();
      expect(screen.queryByTestId('email-form')).not.toBeInTheDocument();
    });

    it('shows LoadingScreen with auth message when authLoading is true', () => {
      // Arrange
      mockUseMerchant.mockReturnValue({ loading: false });
      mockUseCustomerAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: true,
      });

      // Act
      render(<OgabasseyLoginPage />);

      // Assert
      expect(screen.getByTestId('loading-screen')).toBeInTheDocument();
      expect(
        screen.getByText('Checking authentication...'),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('login-header')).not.toBeInTheDocument();
      expect(screen.queryByTestId('email-form')).not.toBeInTheDocument();
    });

    it('shows LoadingScreen when both merchantLoading and authLoading are true', () => {
      // Arrange
      mockUseMerchant.mockReturnValue({ loading: true });
      mockUseCustomerAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: true,
      });

      // Act
      render(<OgabasseyLoginPage />);

      // Assert
      expect(screen.getByTestId('loading-screen')).toBeInTheDocument();
      expect(screen.getByText('Loading store data...')).toBeInTheDocument();
    });
  });

  describe('Authentication redirect', () => {
    it('redirects to default path when authenticated without redirect param', () => {
      // Arrange
      mockUseMerchant.mockReturnValue({ loading: false });
      mockUseCustomerAuth.mockReturnValue({
        isAuthenticated: true,
        isLoading: false,
      });
      mockSearchParams.get = vi.fn(() => null);

      // Act
      render(<OgabasseyLoginPage />);

      // Assert - useEffect should trigger redirect to /account (default)
      expect(mockPush).toHaveBeenCalledWith('/account');
    });

    it('redirects to sanitized redirect path when authenticated with redirect param', () => {
      // Arrange
      mockUseMerchant.mockReturnValue({ loading: false });
      mockUseCustomerAuth.mockReturnValue({
        isAuthenticated: true,
        isLoading: false,
      });
      mockSearchParams.get = vi.fn(() => '/account/orders');

      // Act
      render(<OgabasseyLoginPage />);

      // Assert - useEffect should trigger redirect
      expect(mockPush).toHaveBeenCalledWith('/account/orders');
    });

    it('does not redirect when still loading', () => {
      // Arrange
      mockUseMerchant.mockReturnValue({ loading: false });
      mockUseCustomerAuth.mockReturnValue({
        isAuthenticated: true,
        isLoading: true,
      });

      // Act
      render(<OgabasseyLoginPage />);

      // Assert
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('does not redirect when not authenticated', () => {
      // Arrange
      mockUseMerchant.mockReturnValue({ loading: false });
      mockUseCustomerAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
      });

      // Act
      render(<OgabasseyLoginPage />);

      // Assert
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  describe('Email form view', () => {
    it('passes a sanitized email hint to the login hook', () => {
      // Arrange
      mockSearchParams.get = vi.fn((key) =>
        key === 'email' ? '  BasseyBJohn@Yahoo.CO.UK  ' : null
      );

      // Act
      render(<OgabasseyLoginPage />);

      // Assert
      expect(mockUseOgabasseyLogin).toHaveBeenCalledWith({
        initialEmail: 'basseybjohn@yahoo.co.uk',
        redirectTo: '/account',
      });
    });

    it('shows masked receipt claim guidance without prefilling the input', async () => {
      const setEmail = vi.fn();
      const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify({ emailHint: 'b***@yahoo.co.uk' }), {
          status: 200,
        })
      );
      vi.stubGlobal('fetch', fetchMock);
      mockSearchParams.get = vi.fn((key) =>
        key === 'redirect' ? '/receipts/claim/token_123' : null
      );
      mockUseOgabasseyLogin.mockReturnValue({
        email: '',
        code: ['', '', '', '', '', ''],
        error: null,
        isSending: false,
        isVerifying: false,
        isGoogleLoading: false,
        isAppleLoading: false,
        isCodeSent: false,
        sentToEmail: '',
        setEmail,
        handleSendCode: vi.fn(),
        handleCodeChange: vi.fn(),
        handleKeyDown: vi.fn(),
        handlePaste: vi.fn(),
        handleResendCode: vi.fn(),
        handleChangeEmail: vi.fn(),
        handleGoogleSignIn: vi.fn(),
        handleAppleSignIn: vi.fn(),
        codeInputRefs: { current: [] },
      });

      render(<OgabasseyLoginPage />);

      await waitFor(() => {
        expect(
          screen.getByText(
            'This receipt was sent to b***@yahoo.co.uk — sign in with that address.'
          )
        ).toBeInTheDocument();
      });
      // The masked hint guides; the input is never prefilled with it.
      expect(setEmail).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/storefront/receipts/claims/token_123/login-email',
        { headers: { accept: 'application/json' } }
      );
    });

    it('clears a stale masked hint when navigating between claim redirects', async () => {
      // Regression: the previous inline effect kept showing the first
      // claim's masked address after navigating to a claim with no hint.
      const fetchMock = vi.fn(async (url: unknown) =>
        String(url).includes('token_123')
          ? new Response(JSON.stringify({ emailHint: 'b***@yahoo.co.uk' }), {
              status: 200,
            })
          : new Response(JSON.stringify({}), { status: 200 })
      );
      vi.stubGlobal('fetch', fetchMock);
      mockSearchParams.get = vi.fn((key) =>
        key === 'redirect' ? '/receipts/claim/token_123' : null
      );

      const { rerender } = render(<OgabasseyLoginPage />);

      await waitFor(() => {
        expect(
          screen.getByText(
            'This receipt was sent to b***@yahoo.co.uk — sign in with that address.'
          )
        ).toBeInTheDocument();
      });

      mockSearchParams.get = vi.fn((key) =>
        key === 'redirect' ? '/receipts/claim/token_456' : null
      );
      rerender(<OgabasseyLoginPage />);

      await waitFor(() => {
        expect(
          screen.queryByText(/This receipt was sent to/)
        ).not.toBeInTheDocument();
      });
    });

    it('renders EmailForm when isCodeSent is false', () => {
      // Arrange
      mockUseMerchant.mockReturnValue({ loading: false });
      mockUseCustomerAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
      });
      mockUseOgabasseyLogin.mockReturnValue({
        email: '',
        code: ['', '', '', '', '', ''],
        error: null,
        isSending: false,
        isVerifying: false,
        isGoogleLoading: false,
        isAppleLoading: false,
        isCodeSent: false,
        sentToEmail: '',
        setEmail: vi.fn(),
        handleSendCode: vi.fn(),
        handleCodeChange: vi.fn(),
        handleKeyDown: vi.fn(),
        handlePaste: vi.fn(),
        handleResendCode: vi.fn(),
        handleChangeEmail: vi.fn(),
        handleGoogleSignIn: vi.fn(),
        handleAppleSignIn: vi.fn(),
        codeInputRefs: { current: [] },
      });

      // Act
      render(<OgabasseyLoginPage />);

      // Assert
      expect(screen.getByTestId('email-form')).toBeInTheDocument();
      expect(screen.queryByTestId('otp-form')).not.toBeInTheDocument();
    });

    it('renders LoginHeader, LoginFooter, and Logo when showing EmailForm', () => {
      // Arrange
      mockUseMerchant.mockReturnValue({ loading: false });
      mockUseCustomerAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
      });
      mockUseOgabasseyLogin.mockReturnValue({
        email: '',
        code: ['', '', '', '', '', ''],
        error: null,
        isSending: false,
        isVerifying: false,
        isGoogleLoading: false,
        isAppleLoading: false,
        isCodeSent: false,
        sentToEmail: '',
        setEmail: vi.fn(),
        handleSendCode: vi.fn(),
        handleCodeChange: vi.fn(),
        handleKeyDown: vi.fn(),
        handlePaste: vi.fn(),
        handleResendCode: vi.fn(),
        handleChangeEmail: vi.fn(),
        handleGoogleSignIn: vi.fn(),
        handleAppleSignIn: vi.fn(),
        codeInputRefs: { current: [] },
      });

      // Act
      render(<OgabasseyLoginPage />);

      // Assert
      expect(screen.getByTestId('login-header')).toBeInTheDocument();
      expect(screen.getByTestId('login-footer')).toBeInTheDocument();
      expect(screen.getByTestId('ogabassey-logo')).toBeInTheDocument();
    });

    it('displays correct heading and description for email entry', () => {
      // Arrange
      mockUseMerchant.mockReturnValue({ loading: false });
      mockUseCustomerAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
      });
      mockUseOgabasseyLogin.mockReturnValue({
        email: '',
        code: ['', '', '', '', '', ''],
        error: null,
        isSending: false,
        isVerifying: false,
        isGoogleLoading: false,
        isAppleLoading: false,
        isCodeSent: false,
        sentToEmail: '',
        setEmail: vi.fn(),
        handleSendCode: vi.fn(),
        handleCodeChange: vi.fn(),
        handleKeyDown: vi.fn(),
        handlePaste: vi.fn(),
        handleResendCode: vi.fn(),
        handleChangeEmail: vi.fn(),
        handleGoogleSignIn: vi.fn(),
        handleAppleSignIn: vi.fn(),
        codeInputRefs: { current: [] },
      });

      // Act
      render(<OgabasseyLoginPage />);

      // Assert
      expect(
        screen.getByText('Sign in or Create account'),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'Enter your email to sign in or sign up instantly',
        ),
      ).toBeInTheDocument();
    });
  });

  describe('OTP verification view', () => {
    it('renders OtpVerificationForm when isCodeSent is true', () => {
      // Arrange
      mockUseMerchant.mockReturnValue({ loading: false });
      mockUseCustomerAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
      });
      mockUseOgabasseyLogin.mockReturnValue({
        email: 'test@example.com',
        code: ['', '', '', '', '', ''],
        error: null,
        isSending: false,
        isVerifying: false,
        isGoogleLoading: false,
        isAppleLoading: false,
        isCodeSent: true,
        sentToEmail: 'test@example.com',
        setEmail: vi.fn(),
        handleSendCode: vi.fn(),
        handleCodeChange: vi.fn(),
        handleKeyDown: vi.fn(),
        handlePaste: vi.fn(),
        handleResendCode: vi.fn(),
        handleChangeEmail: vi.fn(),
        handleGoogleSignIn: vi.fn(),
        handleAppleSignIn: vi.fn(),
        codeInputRefs: { current: [] },
      });

      // Act
      render(<OgabasseyLoginPage />);

      // Assert
      expect(screen.getByTestId('otp-form')).toBeInTheDocument();
      expect(screen.queryByTestId('email-form')).not.toBeInTheDocument();
    });

    it('renders LoginHeader, LoginFooter, and Logo when showing OtpVerificationForm', () => {
      // Arrange
      mockUseMerchant.mockReturnValue({ loading: false });
      mockUseCustomerAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
      });
      mockUseOgabasseyLogin.mockReturnValue({
        email: 'test@example.com',
        code: ['', '', '', '', '', ''],
        error: null,
        isSending: false,
        isVerifying: false,
        isGoogleLoading: false,
        isAppleLoading: false,
        isCodeSent: true,
        sentToEmail: 'test@example.com',
        setEmail: vi.fn(),
        handleSendCode: vi.fn(),
        handleCodeChange: vi.fn(),
        handleKeyDown: vi.fn(),
        handlePaste: vi.fn(),
        handleResendCode: vi.fn(),
        handleChangeEmail: vi.fn(),
        handleGoogleSignIn: vi.fn(),
        handleAppleSignIn: vi.fn(),
        codeInputRefs: { current: [] },
      });

      // Act
      render(<OgabasseyLoginPage />);

      // Assert
      expect(screen.getByTestId('login-header')).toBeInTheDocument();
      expect(screen.getByTestId('login-footer')).toBeInTheDocument();
      expect(screen.getByTestId('ogabassey-logo')).toBeInTheDocument();
    });

    it('displays correct heading and description for OTP verification', () => {
      // Arrange
      const sentEmail = 'test@example.com';
      mockUseMerchant.mockReturnValue({ loading: false });
      mockUseCustomerAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
      });
      mockUseOgabasseyLogin.mockReturnValue({
        email: sentEmail,
        code: ['', '', '', '', '', ''],
        error: null,
        isSending: false,
        isVerifying: false,
        isGoogleLoading: false,
        isAppleLoading: false,
        isCodeSent: true,
        sentToEmail: sentEmail,
        setEmail: vi.fn(),
        handleSendCode: vi.fn(),
        handleCodeChange: vi.fn(),
        handleKeyDown: vi.fn(),
        handlePaste: vi.fn(),
        handleResendCode: vi.fn(),
        handleChangeEmail: vi.fn(),
        handleGoogleSignIn: vi.fn(),
        handleAppleSignIn: vi.fn(),
        codeInputRefs: { current: [] },
      });

      // Act
      render(<OgabasseyLoginPage />);

      // Assert
      expect(screen.getByText('Enter verification code')).toBeInTheDocument();
      expect(
        screen.getByText(`We sent a 6-digit code to ${sentEmail}`),
      ).toBeInTheDocument();
    });
  });

  describe('Hook integration', () => {
    it('passes redirectTo from searchParams to useOgabasseyLogin', () => {
      // Arrange
      const redirectPath = '/account/orders';
      mockSearchParams.get = vi.fn(() => redirectPath);
      mockUseMerchant.mockReturnValue({ loading: false });
      mockUseCustomerAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
      });

      // Act
      render(<OgabasseyLoginPage />);

      // Assert
      expect(mockUseOgabasseyLogin).toHaveBeenCalledWith({
        initialEmail: '',
        redirectTo: redirectPath,
      });
    });

    it('passes default /account redirectTo when no redirect param in URL', () => {
      // Arrange
      mockSearchParams.get = vi.fn(() => null);
      mockUseMerchant.mockReturnValue({ loading: false });
      mockUseCustomerAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
      });

      // Act
      render(<OgabasseyLoginPage />);

      // Assert - sanitizeRedirect converts null to /account
      expect(mockUseOgabasseyLogin).toHaveBeenCalledWith({
        initialEmail: '',
        redirectTo: '/account',
      });
    });
  });

  describe('Layout structure', () => {
    it('renders background gradient elements when not loading', () => {
      // Arrange
      mockUseMerchant.mockReturnValue({ loading: false });
      mockUseCustomerAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
      });

      // Act
      const { container } = render(<OgabasseyLoginPage />);

      // Assert
      const gradients = container.querySelectorAll('.bg-\\[\\#D62027\\]\\/5');
      expect(gradients.length).toBeGreaterThan(0);
    });

    it('renders primary accent line at top when not loading', () => {
      // Arrange
      mockUseMerchant.mockReturnValue({ loading: false });
      mockUseCustomerAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
      });

      // Act
      const { container } = render(<OgabasseyLoginPage />);

      // Assert
      const accentLine = container.querySelector('.bg-\\[\\#D62027\\].h-1\\.5');
      expect(accentLine).toBeInTheDocument();
    });

    it('does not render layout elements when loading', () => {
      // Arrange
      mockUseMerchant.mockReturnValue({ loading: true });
      mockUseCustomerAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
      });

      // Act
      const { container } = render(<OgabasseyLoginPage />);

      // Assert
      const gradients = container.querySelectorAll('.bg-\\[\\#D62027\\]\\/5');
      expect(gradients.length).toBe(0);
    });
  });
});
