import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CustomerLoginPage from './customer-login-page';

const mockPush = vi.fn();
const mockSearchParams = new URLSearchParams();
const mockUseCustomerAuth = vi.fn();
const mockUseMerchant = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) =>
    createElement('img', { alt, src }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/contexts/customer-auth-context', () => ({
  useCustomerAuth: () => mockUseCustomerAuth(),
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: () => mockUseMerchant(),
}));

vi.mock('@/lib/routes', () => ({
  asRoute: vi.fn((path) => path || '/'),
}));

describe('CustomerLoginPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams.delete('email');
    mockSearchParams.delete('redirect');
    mockUseMerchant.mockReturnValue({
      loading: false,
      merchant: {
        brand_colors: { primary: '#dc2626' },
        business_name: 'Future Merchant',
        custom_domain: 'futuremerchant.com',
        logo_url: null,
        slug: 'future-merchant',
        template_id: 'default',
      },
    });
    mockUseCustomerAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      otpState: null,
      sendOtp: vi.fn(),
      signInWithGoogle: vi.fn(),
      verifyOtp: vi.fn(),
    });
  });

  it.each([
    '/\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '/\r/evil.example',
  ])('rejects URL-parser-normalized external redirect %j', async (redirect) => {
    mockSearchParams.set('redirect', redirect);
    mockUseCustomerAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      otpState: null,
    });
    render(<CustomerLoginPage />);
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/account'));
  });

  it('uses the storefront theme for the sign-in button', () => {
    render(<CustomerLoginPage />);
    expect(
      screen.getByRole('button', { name: 'Send sign-in code' })
    ).toHaveClass('bg-store-primary');
  });

  it('submits a six-digit code delivered via autofill', async () => {
    const { verifyOtp } = renderCodeStep();
    fireEvent.change(screen.getByLabelText('Digit 1 of 6'), {
      target: { value: '123456' },
    });
    await waitFor(() => expect(verifyOtp).toHaveBeenCalledWith('123456'));
  });

  it('offers native one-time-code autofill', () => {
    renderCodeStep();
    expect(screen.getByLabelText('Digit 1 of 6')).toHaveAttribute(
      'autocomplete',
      'one-time-code'
    );
  });

  it('prefills a valid email query parameter', () => {
    mockSearchParams.set('email', '  BasseyBJohn@Yahoo.CO.UK  ');

    render(<CustomerLoginPage />);

    expect(screen.getByLabelText('Email address')).toHaveValue(
      'basseybjohn@yahoo.co.uk'
    );
  });

  it('ignores invalid email query parameters', () => {
    mockSearchParams.set('email', 'https://evil.example');

    render(<CustomerLoginPage />);

    expect(screen.getByLabelText('Email address')).toHaveValue('');
  });

  it('prefills receipt claim login email from the token redirect', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ emailHint: '  BasseyBJohn@Yahoo.CO.UK  ' }),
          { status: 200 }
        )
    );
    vi.stubGlobal('fetch', fetchMock);
    mockSearchParams.set('redirect', '/receipts/claim/token_123');

    render(<CustomerLoginPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Email address')).toHaveValue(
        'basseybjohn@yahoo.co.uk'
      );
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/storefront/receipts/claims/token_123/login-email',
      { headers: { accept: 'application/json' } }
    );
  });
  function renderCodeStep() {
    const verifyOtp = vi.fn().mockResolvedValue({ success: true });
    const sendOtp = vi.fn().mockResolvedValue({ success: true });
    mockUseCustomerAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      otpState: { codeSent: true, email: 'buyer@example.com' },
      verifyOtp,
      sendOtp,
    });
    mockSearchParams.set('redirect', '/imei-check');
    render(<CustomerLoginPage />);
    return { verifyOtp, sendOtp };
  }

  it('submits the entered six digits and redirects only after verification succeeds', async () => {
    const { verifyOtp } = renderCodeStep();
    const pending = Promise.withResolvers<{ success: boolean }>();
    verifyOtp.mockReturnValueOnce(pending.promise);
    for (let index = 0; index < 6; index++) {
      fireEvent.change(screen.getByLabelText(`Digit ${index + 1} of 6`), {
        target: { value: String(index + 1) },
      });
    }
    expect(verifyOtp).toHaveBeenCalledWith('123456');
    expect(mockPush).not.toHaveBeenCalled();
    pending.resolve({ success: true });
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/imei-check'));
  });

  it('pastes a complete code, displays verification failure and clears the digits', async () => {
    const { verifyOtp } = renderCodeStep();
    verifyOtp.mockResolvedValueOnce({ success: false, error: 'Code expired' });
    fireEvent.paste(screen.getByLabelText('Digit 1 of 6'), {
      clipboardData: { getData: () => '123456' },
    });
    await waitFor(() => expect(screen.getByText('Code expired')).toBeVisible());
    expect(verifyOtp).toHaveBeenCalledWith('123456');
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Digit 1 of 6')).toHaveValue('');
    expect(screen.getByLabelText('Digit 1 of 6')).toHaveFocus();
  });

  it('returns to the email form when choosing a different email', async () => {
    renderCodeStep();
    fireEvent.click(
      screen.getByRole('button', { name: 'Use a different email' })
    );
    expect(screen.getByLabelText('Email address')).toBeVisible();
    expect(screen.queryByLabelText('Digit 1 of 6')).not.toBeInTheDocument();
  });

  it('keeps email entry open when sending to the replacement address fails', async () => {
    const { sendOtp } = renderCodeStep();
    sendOtp.mockResolvedValueOnce({
      success: false,
      error: 'Could not send code',
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Use a different email' })
    );
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'new@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send sign-in code' }));
    await waitFor(() =>
      expect(screen.getByText('Could not send code')).toBeVisible()
    );
    expect(sendOtp).toHaveBeenCalledWith('new@example.com');
    expect(screen.getByLabelText('Email address')).toBeVisible();
  });

  it('resends to the challenge email and clears partial digits', async () => {
    const { sendOtp } = renderCodeStep();
    fireEvent.change(screen.getByLabelText('Digit 1 of 6'), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
    await waitFor(() =>
      expect(sendOtp).toHaveBeenCalledWith('buyer@example.com')
    );
    expect(screen.getByLabelText('Digit 1 of 6')).toHaveValue('');
    expect(mockPush).not.toHaveBeenCalled();
  });
});
