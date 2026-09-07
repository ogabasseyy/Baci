import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CryptoSelectorModal } from './CryptoSelectorModal';
import type { CryptoChain, CryptoCurrency } from '../types';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  CreditCard: ({ size, className }: { size?: number; className?: string }) => (
    <div data-testid="credit-card-icon" data-size={size} className={className} />
  ),
  Clock: ({ size, className }: { size?: number; className?: string }) => (
    <div data-testid="clock-icon" data-size={size} className={className} />
  ),
  Loader2: ({ size, className }: { size?: number; className?: string }) => (
    <div data-testid="loader2-icon" data-size={size} className={className} />
  ),
  X: ({ size, className }: { size?: number; className?: string }) => (
    <div data-testid="x-icon" data-size={size} className={className} />
  ),
}));

// Mock utils with crypto chain support constants
vi.mock('../utils', () => ({
  CRYPTO_CHAIN_SUPPORT: {
    USDT: ['TRX', 'ETH', 'MATIC', 'AVAXC'],
    USDC: ['ETH', 'MATIC', 'AVAXC'],
  },
  CHAIN_DISPLAY_NAMES: {
    TRX: 'Tron (TRC-20)',
    ETH: 'Ethereum (ERC-20)',
    MATIC: 'Polygon',
    AVAXC: 'Avalanche C-Chain',
  },
}));

describe('CryptoSelectorModal', () => {
  const mockOnCurrencyChange = vi.fn();
  const mockOnChainChange = vi.fn();
  const mockOnInitialize = vi.fn();
  const mockOnClose = vi.fn();

  const defaultProps = {
    selectedCryptoCurrency: 'USDT' as CryptoCurrency,
    selectedCryptoChain: 'TRX' as CryptoChain,
    isInitializingCrypto: false,
    onCurrencyChange: mockOnCurrencyChange,
    onChainChange: mockOnChainChange,
    onInitialize: mockOnInitialize,
    onClose: mockOnClose,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dims the animated checkout without a backdrop filter while selecting crypto', () => {
    const { container } = render(<CryptoSelectorModal {...defaultProps} />);
    expect(container.firstElementChild).toHaveClass('bg-black/50');
    expect(container.firstElementChild).not.toHaveClass('backdrop-blur-xs');
  });

  it('shows only the chains enabled by checkout for the selected currency', () => {
    render(<CryptoSelectorModal {...defaultProps} supportedChains={['TRX', 'ETH']} />);
    expect(screen.getByRole('button', { name: 'TRX Tron' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /MATIC/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /AVAXC/ })).not.toBeInTheDocument();
  });

  describe('Rendering', () => {
    it('renders modal with correct title', () => {
      render(<CryptoSelectorModal {...defaultProps} />);

      expect(screen.getByText('Select Crypto Payment')).toBeInTheDocument();
    });

    it('renders currency options (USDT and USDC)', () => {
      render(<CryptoSelectorModal {...defaultProps} />);

      expect(screen.getByText('USDT')).toBeInTheDocument();
      expect(screen.getByText('Tether USD')).toBeInTheDocument();
      expect(screen.getByText('USDC')).toBeInTheDocument();
      expect(screen.getByText('USD Coin')).toBeInTheDocument();
    });

    it('renders all chain options for USDT (4 chains)', () => {
      render(<CryptoSelectorModal {...defaultProps} />);

      expect(screen.getByText('TRX')).toBeInTheDocument();
      expect(screen.getByText('ETH')).toBeInTheDocument();
      expect(screen.getByText('MATIC')).toBeInTheDocument();
      expect(screen.getByText('AVAXC')).toBeInTheDocument();
    });

    it('renders only 3 chain options for USDC (no TRX)', () => {
      render(
        <CryptoSelectorModal
          {...defaultProps}
          selectedCryptoCurrency="USDC"
          selectedCryptoChain="ETH"
        />
      );

      expect(screen.queryByText('TRX')).not.toBeInTheDocument();
      expect(screen.getByText('ETH')).toBeInTheDocument();
      expect(screen.getByText('MATIC')).toBeInTheDocument();
      expect(screen.getByText('AVAXC')).toBeInTheDocument();
    });

    it('renders chain display names without protocol suffix', () => {
      render(<CryptoSelectorModal {...defaultProps} />);

      expect(screen.getByText('Tron')).toBeInTheDocument();
      expect(screen.getByText('Ethereum')).toBeInTheDocument();
      expect(screen.getByText('Polygon')).toBeInTheDocument();
      expect(screen.getByText('Avalanche C-Chain')).toBeInTheDocument();
    });

    it('highlights selected currency', () => {
      render(<CryptoSelectorModal {...defaultProps} />);

      const usdtButton = screen.getByText('USDT').closest('button');
      expect(usdtButton).toHaveClass('border-store-primary');
      expect(usdtButton).toHaveClass('bg-store-primary/5');
    });

    it('highlights selected chain', () => {
      render(<CryptoSelectorModal {...defaultProps} />);

      const trxButton = screen.getByText('TRX').closest('button');
      expect(trxButton).toHaveClass('border-store-primary');
      expect(trxButton).toHaveClass('bg-store-primary/5');
    });

    it('renders close button', () => {
      render(<CryptoSelectorModal {...defaultProps} />);

      expect(screen.getByTestId('x-icon')).toBeInTheDocument();
    });
  });

  describe('Confirmation Time Display', () => {
    it('shows 1-3 minutes for TRX chain', () => {
      render(
        <CryptoSelectorModal
          {...defaultProps}
          selectedCryptoChain="TRX"
        />
      );

      expect(screen.getByText('1-3 minutes')).toBeInTheDocument();
      expect(screen.getByText('Expected confirmation time')).toBeInTheDocument();
    });

    it('shows 5-30 minutes for ETH chain', () => {
      render(
        <CryptoSelectorModal
          {...defaultProps}
          selectedCryptoChain="ETH"
        />
      );

      expect(screen.getByText('5-30 minutes')).toBeInTheDocument();
    });

    it('shows 1-5 minutes for MATIC chain', () => {
      render(
        <CryptoSelectorModal
          {...defaultProps}
          selectedCryptoChain="MATIC"
        />
      );

      expect(screen.getByText('1-5 minutes')).toBeInTheDocument();
    });

    it('shows 1-5 minutes for AVAXC chain', () => {
      render(
        <CryptoSelectorModal
          {...defaultProps}
          selectedCryptoChain="AVAXC"
        />
      );

      expect(screen.getByText('1-5 minutes')).toBeInTheDocument();
    });
  });

  describe('User Interactions', () => {
    it('calls onCurrencyChange when clicking USDC', () => {
      render(<CryptoSelectorModal {...defaultProps} />);

      const usdcButton = screen.getByText('USDC').closest('button');
      fireEvent.click(usdcButton!);

      expect(mockOnCurrencyChange).toHaveBeenCalledWith('USDC');
      expect(mockOnCurrencyChange).toHaveBeenCalledTimes(1);
    });

    it('calls onCurrencyChange when clicking USDT', () => {
      render(
        <CryptoSelectorModal
          {...defaultProps}
          selectedCryptoCurrency="USDC"
        />
      );

      const usdtButton = screen.getByText('USDT').closest('button');
      fireEvent.click(usdtButton!);

      expect(mockOnCurrencyChange).toHaveBeenCalledWith('USDT');
    });

    it('calls onChainChange when clicking ETH chain', () => {
      render(<CryptoSelectorModal {...defaultProps} />);

      const ethButton = screen.getByText('ETH').closest('button');
      fireEvent.click(ethButton!);

      expect(mockOnChainChange).toHaveBeenCalledWith('ETH');
      expect(mockOnChainChange).toHaveBeenCalledTimes(1);
    });

    it('calls onChainChange when clicking MATIC chain', () => {
      render(<CryptoSelectorModal {...defaultProps} />);

      const maticButton = screen.getByText('MATIC').closest('button');
      fireEvent.click(maticButton!);

      expect(mockOnChainChange).toHaveBeenCalledWith('MATIC');
    });

    it('calls onClose when clicking X button', () => {
      render(<CryptoSelectorModal {...defaultProps} />);

      const closeButton = screen.getByTestId('x-icon').closest('button');
      fireEvent.click(closeButton!);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('calls onInitialize when clicking continue button', () => {
      render(<CryptoSelectorModal {...defaultProps} />);

      const continueButton = screen.getByRole('button', {
        name: /continue with usdt on trx/i,
      });
      fireEvent.click(continueButton);

      expect(mockOnInitialize).toHaveBeenCalledTimes(1);
    });

    it('does not call onInitialize when button is disabled', () => {
      render(
        <CryptoSelectorModal
          {...defaultProps}
          isInitializingCrypto={true}
        />
      );

      const continueButton = screen.getByRole('button', {
        name: /generating address/i,
      });
      fireEvent.click(continueButton);

      expect(mockOnInitialize).not.toHaveBeenCalled();
    });
  });

  describe('Loading State', () => {
    it('shows loading spinner when isInitializingCrypto is true', () => {
      render(
        <CryptoSelectorModal
          {...defaultProps}
          isInitializingCrypto={true}
        />
      );

      expect(screen.getByTestId('loader2-icon')).toBeInTheDocument();
      expect(screen.getByText('Generating Address…')).toBeInTheDocument();
    });

    it('disables continue button when isInitializingCrypto is true', () => {
      render(
        <CryptoSelectorModal
          {...defaultProps}
          isInitializingCrypto={true}
        />
      );

      const continueButton = screen.getByRole('button', {
        name: /generating address/i,
      });
      expect(continueButton).toBeDisabled();
    });

    it('shows correct button text when not initializing', () => {
      render(<CryptoSelectorModal {...defaultProps} />);

      expect(
        screen.getByText('Continue with USDT on TRX')
      ).toBeInTheDocument();
    });

    it('shows correct button text with USDC and ETH selection', () => {
      render(
        <CryptoSelectorModal
          {...defaultProps}
          selectedCryptoCurrency="USDC"
          selectedCryptoChain="ETH"
        />
      );

      expect(
        screen.getByText('Continue with USDC on ETH')
      ).toBeInTheDocument();
    });

    it('enables continue button when not initializing', () => {
      render(<CryptoSelectorModal {...defaultProps} />);

      const continueButton = screen.getByRole('button', {
        name: /continue with usdt on trx/i,
      });
      expect(continueButton).not.toBeDisabled();
    });
  });

  describe('Modal Content', () => {
    it('renders section labels', () => {
      render(<CryptoSelectorModal {...defaultProps} />);

      expect(screen.getByText('Select Stablecoin')).toBeInTheDocument();
      expect(screen.getByText('Select Network')).toBeInTheDocument();
    });

    it('renders helper text about wallet address', () => {
      render(<CryptoSelectorModal {...defaultProps} />);

      expect(
        screen.getByText(/You'll receive a wallet address/i)
      ).toBeInTheDocument();
      expect(
        screen.getByText(/to send your USDT payment/i)
      ).toBeInTheDocument();
    });

    it('updates helper text when USDC is selected', () => {
      render(
        <CryptoSelectorModal
          {...defaultProps}
          selectedCryptoCurrency="USDC"
        />
      );

      expect(
        screen.getByText(/to send your USDC payment/i)
      ).toBeInTheDocument();
    });

    it('renders clock icon for confirmation time section', () => {
      render(<CryptoSelectorModal {...defaultProps} />);

      expect(screen.getByTestId('clock-icon')).toBeInTheDocument();
    });

    it('renders credit card icon in header', () => {
      render(<CryptoSelectorModal {...defaultProps} />);

      expect(screen.getByTestId('credit-card-icon')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles switching from USDT to USDC when TRX is selected', () => {
      const { rerender } = render(<CryptoSelectorModal {...defaultProps} />);

      // Initially TRX should be visible
      expect(screen.getByText('TRX')).toBeInTheDocument();

      // Switch to USDC (which doesn't support TRX)
      rerender(
        <CryptoSelectorModal
          {...defaultProps}
          selectedCryptoCurrency="USDC"
          selectedCryptoChain="ETH"
        />
      );

      // TRX should no longer be visible
      expect(screen.queryByText('TRX')).not.toBeInTheDocument();
    });

    it('handles rapid clicks on currency buttons', () => {
      render(<CryptoSelectorModal {...defaultProps} />);

      const usdcButton = screen.getByText('USDC').closest('button');
      fireEvent.click(usdcButton!);
      fireEvent.click(usdcButton!);
      fireEvent.click(usdcButton!);

      expect(mockOnCurrencyChange).toHaveBeenCalledTimes(3);
    });

    it('handles rapid clicks on chain buttons', () => {
      render(<CryptoSelectorModal {...defaultProps} />);

      const ethButton = screen.getByText('ETH').closest('button');
      fireEvent.click(ethButton!);
      fireEvent.click(ethButton!);

      expect(mockOnChainChange).toHaveBeenCalledTimes(2);
    });
  });
});
