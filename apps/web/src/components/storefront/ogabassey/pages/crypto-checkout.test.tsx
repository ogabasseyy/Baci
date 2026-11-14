import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CryptoCheckoutPage } from './crypto-checkout';

// Mock next/navigation
const mockPush = vi.fn();
const mockRouter = { push: mockPush, back: vi.fn() };
let mockSearchParams: URLSearchParams;

const mockUseSearchParams = vi.fn();
const mockUseRouter = vi.fn(() => mockRouter);

vi.mock('next/navigation', () => ({
  useRouter: () => mockUseRouter(),
  usePathname: () => '/checkout/crypto',
  useSearchParams: () => mockUseSearchParams(),
}));

// Mock use-merchant hook
const mockUseMerchant = vi.fn();
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: () => mockUseMerchant(),
}));

// Mock global fetch
const mockFetch = vi.fn();

// Mock clipboard
const mockWriteText = vi.fn();

describe('CryptoCheckoutPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Create fresh search params for each test
    mockSearchParams = new URLSearchParams({
      orderId: 'test-order-123',
      amount: '5000',
      customer_email: 'test@example.com',
      customer_name: 'Test Customer',
      customer_phone: '+2348012345678',
      crypto_chain: 'TRX',
      crypto_currency: 'USDT',
      merchant_slug: 'testmerchant',
    });

    mockUseSearchParams.mockReturnValue(mockSearchParams);

    mockUseMerchant.mockReturnValue({
      merchant: { id: 'merchant-123', slug: 'testmerchant' },
      loading: false,
    });

    global.fetch = mockFetch;

    // Mock clipboard API
    mockWriteText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      writable: true,
      configurable: true,
      value: {
        writeText: mockWriteText,
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows error when orderId is missing', async () => {
    // Arrange
    const paramsWithoutOrderId = new URLSearchParams({
      amount: '5000',
      customer_email: 'test@example.com',
    });
    mockUseSearchParams.mockReturnValue(paramsWithoutOrderId);

    // Act
    render(<CryptoCheckoutPage />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText('Payment Initialization Failed')).toBeInTheDocument();
      expect(screen.getByText('Missing order ID or amount.')).toBeInTheDocument();
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('shows error when amount is missing', async () => {
    // Arrange
    const paramsWithoutAmount = new URLSearchParams({
      orderId: 'test-order-123',
      customer_email: 'test@example.com',
    });
    mockUseSearchParams.mockReturnValue(paramsWithoutAmount);

    // Act
    render(<CryptoCheckoutPage />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText('Payment Initialization Failed')).toBeInTheDocument();
      expect(screen.getByText('Missing order ID or amount.')).toBeInTheDocument();
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('shows loading state while initializing payment', async () => {
    // Arrange
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: true,
              json: async () => ({
                success: true,
                crypto_payment: {
                  address: 'TRXAddressHere123456789',
                  chain: 'TRX',
                  currency: 'USDT',
                  amount: 500000,
                  confirmation_time: '5-10 minutes',
                  payment_id: 'payment-123',
                  qrcode: 'https://example.com/qr.png',
                },
                reference: 'REF-123456',
              }),
            });
          }, 100);
        })
    );

    // Act
    render(<CryptoCheckoutPage />);

    // Assert
    expect(screen.getByText('Preparing Crypto Payment')).toBeInTheDocument();
    expect(screen.getByText('Generating wallet address…')).toBeInTheDocument();
    expect(screen.getByText('Please do not close this window.')).toBeInTheDocument();
  });

  it('shows crypto payment details after successful initialization', async () => {
    // Arrange
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        crypto_payment: {
          address: 'TRXAddressHere123456789',
          chain: 'TRX',
          currency: 'USDT',
          amount: 500000, // 5000.00 in cents
          confirmation_time: '5-10 minutes',
          payment_id: 'payment-123',
          qrcode: 'https://example.com/qr.png',
        },
        reference: 'REF-123456',
      }),
    });

    // Act
    render(<CryptoCheckoutPage />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText('Pay with Crypto')).toBeInTheDocument();
    });

    expect(screen.getByText('5,000')).toBeInTheDocument();
    expect(screen.getAllByText('USDT').length).toBeGreaterThan(0);
    expect(screen.getByText('TRXAddressHere123456789')).toBeInTheDocument();
    expect(screen.getByText('Network: Tron (TRC-20)')).toBeInTheDocument();
    expect(screen.getByText('Expected confirmation')).toBeInTheDocument();
    expect(screen.getByText('5-10 minutes')).toBeInTheDocument();
    expect(screen.getByText('Reference: REF-123456')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /I've Sent the Payment/i })).toBeInTheDocument();

    // Verify API call
    expect(mockFetch).toHaveBeenCalledWith('/api/payments/initialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchant_id: 'merchant-123',
        order_id: 'test-order-123',
        currency: 'NGN',
        customer_email: 'test@example.com',
        customer_name: 'Test Customer',
        customer_phone: '+2348012345678',
        gateway: 'juicyway',
        crypto_chain: 'TRX',
        crypto_currency: 'USDT',
      }),
    });
  });

  it('displays correct chain label for TRX (Tron TRC-20)', async () => {
    // Arrange
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        crypto_payment: {
          address: 'TRXAddressHere123456789',
          chain: 'TRX',
          currency: 'USDT',
          amount: 500000,
          confirmation_time: '5-10 minutes',
          payment_id: 'payment-123',
        },
        reference: 'REF-123456',
      }),
    });

    // Act
    render(<CryptoCheckoutPage />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText('Network: Tron (TRC-20)')).toBeInTheDocument();
    });
  });

  it('displays correct chain label for ETH (Ethereum ERC-20)', async () => {
    // Arrange
    const paramsWithETH = new URLSearchParams({
      orderId: 'test-order-123',
      amount: '5000',
      customer_email: 'test@example.com',
      customer_name: 'Test Customer',
      customer_phone: '+2348012345678',
      crypto_chain: 'ETH',
      crypto_currency: 'USDT',
      merchant_slug: 'testmerchant',
    });
    mockUseSearchParams.mockReturnValue(paramsWithETH);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        crypto_payment: {
          address: 'ETHAddressHere123456789',
          chain: 'ETH',
          currency: 'USDT',
          amount: 500000,
          confirmation_time: '15-20 minutes',
          payment_id: 'payment-123',
        },
        reference: 'REF-123456',
      }),
    });

    // Act
    render(<CryptoCheckoutPage />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText('Network: Ethereum (ERC-20)')).toBeInTheDocument();
    });
  });

  it('shows copy confirmation when copy button is clicked', async () => {
    // Arrange
    const user = userEvent.setup();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        crypto_payment: {
          address: 'TRXAddressHere123456789',
          chain: 'TRX',
          currency: 'USDT',
          amount: 500000,
          confirmation_time: '5-10 minutes',
          payment_id: 'payment-123',
        },
        reference: 'REF-123456',
      }),
    });

    render(<CryptoCheckoutPage />);

    await waitFor(() => {
      expect(screen.getByText('TRXAddressHere123456789')).toBeInTheDocument();
    });

    // Assert initial state
    expect(screen.getByTitle('Copy Address')).toBeInTheDocument();

    // Act - click copy button
    const copyButton = screen.getByTitle('Copy Address');
    await user.click(copyButton);

    // Assert - visual feedback shows copy was successful
    await waitFor(() => {
      expect(screen.getByTitle('Copied!')).toBeInTheDocument();
    });
  });

  it('shows error state on failed payment initialization', async () => {
    // Arrange
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: 'Payment gateway unavailable',
        details: 'Service temporarily unavailable',
      }),
    });

    // Act
    render(<CryptoCheckoutPage />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText('Payment Initialization Failed')).toBeInTheDocument();
      expect(screen.getByText('Service temporarily unavailable')).toBeInTheDocument();
    });

    // Verify Try Again button exists
    expect(screen.getByRole('button', { name: /Try Again/i })).toBeInTheDocument();
  });

  it('shows error when crypto_payment is missing in response', async () => {
    // Arrange
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: false,
      }),
    });

    // Act
    render(<CryptoCheckoutPage />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText('Payment Initialization Failed')).toBeInTheDocument();
      expect(screen.getByText('Failed to generate crypto payment address')).toBeInTheDocument();
    });
  });

  it('waits for merchant loading before initializing payment', async () => {
    // Arrange
    mockUseMerchant.mockReturnValue({
      merchant: null,
      loading: true,
    });

    // Act
    render(<CryptoCheckoutPage />);

    // Assert - should not call fetch while loading
    expect(mockFetch).not.toHaveBeenCalled();

    // Should show loading state (default initial state)
    expect(screen.getByText('Preparing Crypto Payment')).toBeInTheDocument();
  });

  it('uses fallback QR code URL when qrcode is not provided', async () => {
    // Arrange
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        crypto_payment: {
          address: 'TRXAddressHere123456789',
          chain: 'TRX',
          currency: 'USDT',
          amount: 500000,
          confirmation_time: '5-10 minutes',
          payment_id: 'payment-123',
          // qrcode is missing
        },
        reference: 'REF-123456',
      }),
    });

    // Act
    render(<CryptoCheckoutPage />);

    // Assert
    await waitFor(() => {
      const qrImage = screen.getByAltText('Scan to pay') as HTMLImageElement;
      expect(qrImage.src).toContain('api.qrserver.com');
      expect(qrImage.src).toContain('TRXAddressHere123456789');
    });
  });

  it('handles network errors during initialization', async () => {
    // Arrange
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    // Act
    render(<CryptoCheckoutPage />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText('Payment Initialization Failed')).toBeInTheDocument();
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('disables verify button while verifying', async () => {
    // Arrange
    const user = userEvent.setup();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        crypto_payment: {
          address: 'TRXAddressHere123456789',
          chain: 'TRX',
          currency: 'USDT',
          amount: 500000,
          confirmation_time: '5-10 minutes',
          payment_id: 'payment-123',
        },
        reference: 'REF-123456',
      }),
    });

    // Mock status endpoint
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'pending' }),
    });

    render(<CryptoCheckoutPage />);

    await waitFor(() => {
      expect(screen.getByText('Pay with Crypto')).toBeInTheDocument();
    });

    // Act - click verify button
    const verifyButton = screen.getByRole('button', { name: /I've Sent the Payment/i });
    await user.click(verifyButton);

    // Assert - button should be disabled
    await waitFor(() => {
      expect(screen.getByText(/Verifying Payment…/i)).toBeInTheDocument();
      const disabledButton = screen.getByRole('button', { name: /Verifying Payment…/i });
      expect(disabledButton).toBeDisabled();
    });
  });

  it('shows warning about correct network', async () => {
    // Arrange
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        crypto_payment: {
          address: 'TRXAddressHere123456789',
          chain: 'TRX',
          currency: 'USDT',
          amount: 500000,
          confirmation_time: '5-10 minutes',
          payment_id: 'payment-123',
        },
        reference: 'REF-123456',
      }),
    });

    // Act
    render(<CryptoCheckoutPage />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/Warning:/i)).toBeInTheDocument();
      expect(screen.getByText(/Only send/i)).toBeInTheDocument();
      expect(screen.getByText(/Using the wrong network will result in permanent loss./i)).toBeInTheDocument();
    });
  });

  it('preserves trackingToken when redirecting after a confirmed payment', async () => {
    const paramsWithTrackingToken = new URLSearchParams({
      orderId: 'test-order-123',
      amount: '5000',
      customer_email: 'test@example.com',
      customer_name: 'Test Customer',
      customer_phone: '+2348012345678',
      crypto_chain: 'TRX',
      crypto_currency: 'USDT',
      merchant_slug: 'testmerchant',
      trackingToken: 'track-token-123',
    });
    mockUseSearchParams.mockReturnValue(paramsWithTrackingToken);

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          crypto_payment: {
            address: 'TRXAddressHere123456789',
            chain: 'TRX',
            currency: 'USDT',
            amount: 500000,
            confirmation_time: '5-10 minutes',
            payment_id: 'payment-123',
          },
          reference: 'REF-123456',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'confirmed' }),
      });

    render(<CryptoCheckoutPage />);

    await waitFor(() => {
      expect(screen.getByText('Pay with Crypto')).toBeInTheDocument();
    });

    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: /I've Sent the Payment/i })
        );
        await vi.runAllTimersAsync();
      });

      expect(mockPush).toHaveBeenCalledWith(
        '/testmerchant/order-success?type=crypto&orderId=test-order-123&reference=REF-123456&trackingToken=track-token-123'
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts tracking_token when redirecting after a confirmed payment', async () => {
    const paramsWithTrackingTokenAlias = new URLSearchParams({
      orderId: 'test-order-123',
      amount: '5000',
      customer_email: 'test@example.com',
      customer_name: 'Test Customer',
      customer_phone: '+2348012345678',
      crypto_chain: 'TRX',
      crypto_currency: 'USDT',
      merchant_slug: 'testmerchant',
      tracking_token: 'snake-track-token-123',
    });
    mockUseSearchParams.mockReturnValue(paramsWithTrackingTokenAlias);

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          crypto_payment: {
            address: 'TRXAddressHere123456789',
            chain: 'TRX',
            currency: 'USDT',
            amount: 500000,
            confirmation_time: '5-10 minutes',
            payment_id: 'payment-123',
          },
          reference: 'REF-123456',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'confirmed' }),
      });

    render(<CryptoCheckoutPage />);

    await waitFor(() => {
      expect(screen.getByText('Pay with Crypto')).toBeInTheDocument();
    });

    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: /I've Sent the Payment/i })
        );
        await vi.runAllTimersAsync();
      });

      expect(mockPush).toHaveBeenCalledWith(
        '/testmerchant/order-success?type=crypto&orderId=test-order-123&reference=REF-123456&trackingToken=snake-track-token-123'
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
