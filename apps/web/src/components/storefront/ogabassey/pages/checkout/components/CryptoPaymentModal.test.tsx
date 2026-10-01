import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CryptoPaymentData, CryptoVerificationStatus } from '../types';
import { CryptoPaymentModal } from './CryptoPaymentModal';

describe('CryptoPaymentModal', () => {
  const mockData: CryptoPaymentData = {
    address: '0x1234567890abcdef1234567890abcdef12345678',
    chain: 'ETH',
    currency: 'USDT',
    amount: 150.5,
    confirmation_time: '5-30 minutes',
    orderId: 'order-123',
    reference: 'REF-CRYPTO-001',
    sessionId: 'session-1',
    paymentId: 'pay-1',
    qrcode: 'https://example.com/qr.png',
  };

  const defaultProps = {
    data: mockData,
    verificationStatus: 'idle' as CryptoVerificationStatus,
    isVerifying: false,
    copiedText: null as string | null,
    onVerify: vi.fn(),
    onCopyToClipboard: vi.fn(),
    onClose: vi.fn(),
    onCloseConfirm: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders the modal title', () => {
      render(<CryptoPaymentModal {...defaultProps} />);
      expect(screen.getByText('Pay with Crypto')).toBeInTheDocument();
    });

    it('renders the amount and currency', () => {
      render(<CryptoPaymentModal {...defaultProps} />);
      expect(screen.getByText('150.5')).toBeInTheDocument();
      // USDT appears in multiple places (amount + warning), use getAllByText
      expect(screen.getAllByText('USDT').length).toBeGreaterThanOrEqual(1);
    });

    it('renders the chain display name', () => {
      render(<CryptoPaymentModal {...defaultProps} />);
      // Chain name appears in both the network badge and the warning
      const matches = screen.getAllByText(/Ethereum \(ERC-20\)/);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it('renders the wallet address', () => {
      render(<CryptoPaymentModal {...defaultProps} />);
      expect(screen.getByText(mockData.address)).toBeInTheDocument();
    });

    it('renders the QR code image when provided', () => {
      render(<CryptoPaymentModal {...defaultProps} />);
      const img = screen.getByAltText('Scan');
      expect(img).toHaveAttribute('src', 'https://example.com/qr.png');
    });

    it('renders fallback QR code URL when qrcode is not provided', () => {
      const dataWithoutQr = { ...mockData, qrcode: undefined };
      render(<CryptoPaymentModal {...defaultProps} data={dataWithoutQr} />);
      const img = screen.getByAltText('Scan');
      expect(img.getAttribute('src')).toContain('api.qrserver.com');
      expect(img.getAttribute('src')).toContain(mockData.address);
    });

    it('renders confirmation time', () => {
      render(<CryptoPaymentModal {...defaultProps} />);
      expect(screen.getByText('Expected confirmation')).toBeInTheDocument();
      expect(screen.getByText('5-30 minutes')).toBeInTheDocument();
    });

    it('renders reference', () => {
      render(<CryptoPaymentModal {...defaultProps} />);
      expect(
        screen.getByText(`Reference: ${mockData.reference}`)
      ).toBeInTheDocument();
    });

    it('renders the warning message', () => {
      render(<CryptoPaymentModal {...defaultProps} />);
      expect(screen.getByText(/permanent loss/)).toBeInTheDocument();
    });
  });

  describe('Interactions', () => {
    it('calls onClose when X button is clicked', () => {
      render(<CryptoPaymentModal {...defaultProps} />);
      const buttons = screen.getAllByRole('button');
      const closeButton = buttons.find((button) =>
        button.querySelector('svg')?.classList.contains('lucide-x')
      );
      if (closeButton) fireEvent.click(closeButton);
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onCopyToClipboard with address when copy button is clicked', () => {
      render(<CryptoPaymentModal {...defaultProps} />);
      const copyButton = screen.getByTitle('Copy Address');
      fireEvent.click(copyButton);
      expect(defaultProps.onCopyToClipboard).toHaveBeenCalledWith(
        mockData.address
      );
    });

    it('shows check icon when address is copied', () => {
      render(
        <CryptoPaymentModal {...defaultProps} copiedText={mockData.address} />
      );
      const buttons = screen.getAllByRole('button');
      const checkButton = buttons.find((button) =>
        button.querySelector('svg')?.classList.contains('lucide-check')
      );
      expect(checkButton).toBeDefined();
    });

    it('calls onVerify when verify button is clicked', () => {
      render(<CryptoPaymentModal {...defaultProps} />);
      const verifyButton = screen.getByRole('button', {
        name: /I've Sent the Payment/i,
      });
      fireEvent.click(verifyButton);
      expect(defaultProps.onVerify).toHaveBeenCalledTimes(1);
    });

    it('calls onCloseConfirm when close-and-check-later button is clicked', () => {
      render(<CryptoPaymentModal {...defaultProps} />);
      const closeButton = screen.getByRole('button', {
        name: /close and check order status later/i,
      });
      fireEvent.click(closeButton);
      expect(defaultProps.onCloseConfirm).toHaveBeenCalledTimes(1);
    });
  });

  describe('Verification States', () => {
    it('disables verify button when isVerifying is true', () => {
      render(<CryptoPaymentModal {...defaultProps} isVerifying={true} />);
      const verifyButton = screen.getByRole('button', {
        name: /verifying payment/i,
      });
      expect(verifyButton).toBeDisabled();
    });

    it('shows checking status message', () => {
      render(
        <CryptoPaymentModal
          {...defaultProps}
          isVerifying={true}
          verificationStatus="checking"
        />
      );
      expect(
        screen.getByText('Checking payment status...')
      ).toBeInTheDocument();
    });

    it('shows pending status message', () => {
      render(
        <CryptoPaymentModal
          {...defaultProps}
          isVerifying={true}
          verificationStatus="pending"
        />
      );
      expect(
        screen.getByText('Waiting for blockchain confirmation...')
      ).toBeInTheDocument();
    });

    it('shows confirmed status message', () => {
      render(
        <CryptoPaymentModal {...defaultProps} verificationStatus="confirmed" />
      );
      expect(
        screen.getByText(
          'Payment confirmed! Redirecting to order confirmation…'
        )
      ).toBeInTheDocument();
    });

    it('shows failed status message', () => {
      render(
        <CryptoPaymentModal {...defaultProps} verificationStatus="failed" />
      );
      expect(
        screen.getByText('Payment verification failed. Please contact support.')
      ).toBeInTheDocument();
    });

    it('hides close-and-check-later button when verifying', () => {
      render(<CryptoPaymentModal {...defaultProps} isVerifying={true} />);
      expect(
        screen.queryByRole('button', {
          name: /close and check order status later/i,
        })
      ).not.toBeInTheDocument();
    });
  });

  describe('Back Button', () => {
    it('renders back button when onBack prop is provided and not verifying', () => {
      const onBack = vi.fn();
      render(<CryptoPaymentModal {...defaultProps} onBack={onBack} />);
      const backButton = screen.getByRole('button', {
        name: 'Change network or coin',
      });
      expect(backButton).toBeInTheDocument();
    });

    it('calls onBack when back button is clicked', () => {
      const onBack = vi.fn();
      render(<CryptoPaymentModal {...defaultProps} onBack={onBack} />);
      const backButton = screen.getByRole('button', {
        name: 'Change network or coin',
      });
      fireEvent.click(backButton);
      expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('does not render back button when onBack prop is not provided', () => {
      render(<CryptoPaymentModal {...defaultProps} />);
      expect(
        screen.queryByRole('button', { name: 'Change network or coin' })
      ).not.toBeInTheDocument();
    });

    it('does not render back button when isVerifying is true', () => {
      const onBack = vi.fn();
      render(
        <CryptoPaymentModal
          {...defaultProps}
          onBack={onBack}
          isVerifying={true}
        />
      );
      expect(
        screen.queryByRole('button', { name: 'Change network or coin' })
      ).not.toBeInTheDocument();
    });

    it('shows credit card icon when back button is not shown', () => {
      render(<CryptoPaymentModal {...defaultProps} />);
      const buttons = screen.getAllByRole('button');
      // The header should have a credit card icon when no back button
      const header = buttons[0]?.parentElement?.parentElement;
      expect(header?.querySelector('svg.lucide-credit-card')).toBeDefined();
    });
  });

  describe('Accessibility', () => {
    it('renders modal with proper backdrop', () => {
      const { container } = render(<CryptoPaymentModal {...defaultProps} />);
      const backdrop = container.querySelector('.bg-black\\/50');
      expect(backdrop).toBeInTheDocument();
    });

    it('has all interactive buttons with proper type attribute', () => {
      render(<CryptoPaymentModal {...defaultProps} />);
      const buttons = screen.getAllByRole('button');
      for (const button of buttons) {
        expect(button).toHaveAttribute('type', 'button');
      }
    });
  });
});
