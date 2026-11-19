import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

});
