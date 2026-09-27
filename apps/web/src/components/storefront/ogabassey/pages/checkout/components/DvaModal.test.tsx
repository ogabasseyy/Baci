import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DvaModal } from './DvaModal';
import type { DvaData } from '../types';

describe('DvaModal', () => {
  const mockDvaData: DvaData = {
    account_number: '1234567890',
    account_name: 'John Doe',
    bank_name: 'Test Bank',
    bank_code: 'TST',
    amount: 50000,
    reference: 'REF-123456',
  };

  const mockOnCopyToClipboard = vi.fn();
  const mockOnClose = vi.fn();
  const mockOnConfirmTransfer = vi.fn();

  beforeEach(() => {
    mockOnCopyToClipboard.mockReset();
    mockOnClose.mockReset();
    mockOnConfirmTransfer.mockReset();
  });

  const renderDvaModal = (
    data: DvaData = mockDvaData,
    copiedText: string | null = null
  ) =>
    render(
      <DvaModal
        copiedText={copiedText}
        data={data}
        formatCurrency={(amount) => `₦${amount.toLocaleString()}`}
        isVerifying={false}
        onClose={mockOnClose}
        onConfirmTransfer={mockOnConfirmTransfer}
        onCopyToClipboard={mockOnCopyToClipboard}
      />
    );

  describe('Rendering', () => {
    it('renders bank transfer modal with title', () => {
      renderDvaModal(mockDvaData, null);

      expect(screen.getByText('Bank Transfer')).toBeInTheDocument();
      expect(screen.getByText('Automatic verification')).toBeInTheDocument();
    });

    it('renders the amount to pay formatted correctly', () => {
      renderDvaModal(mockDvaData, null);

      expect(screen.getByText('Send Exactly')).toBeInTheDocument();
      expect(screen.getByText('₦50,000')).toBeInTheDocument();
    });

    it('renders account number', () => {
      renderDvaModal(mockDvaData, null);

      expect(screen.getByText('Account Number')).toBeInTheDocument();
      expect(screen.getByText('1234567890')).toBeInTheDocument();
    });

    it('renders bank name', () => {
      renderDvaModal(mockDvaData, null);

      expect(screen.getByText('Bank Name')).toBeInTheDocument();
      expect(screen.getByText('Test Bank')).toBeInTheDocument();
    });

    it('renders account name', () => {
      renderDvaModal(mockDvaData, null);

      expect(screen.getByText('Account Name')).toBeInTheDocument();
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    it('renders transfer expiry message', () => {
      renderDvaModal(mockDvaData, null);

      expect(screen.getByText('Transfer expires in 60:00')).toBeInTheDocument();
      expect(
        screen.getByText(
          /Make your transfer within the next hour. Your order will be confirmed automatically once the payment is detected./i
        )
      ).toBeInTheDocument();
    });

    it('renders waiting for transfer status', () => {
      renderDvaModal(mockDvaData, null);

      expect(screen.getByText('Waiting for transfer…')).toBeInTheDocument();
    });

    it('renders reference number', () => {
      renderDvaModal(mockDvaData, null);

      expect(screen.getByText('Reference: REF-123456')).toBeInTheDocument();
    });
  });

  describe('Copy to Clipboard', () => {
    it('renders copy button for account number when text is not copied', () => {
      renderDvaModal(mockDvaData, null);

      // Find the copy button (there's only one copy button in the modal)
      const buttons = screen.getAllByRole('button');
      const copyButton = buttons.find((button) =>
        button.querySelector('svg')?.classList.contains('lucide-copy')
      );

      expect(copyButton).toBeInTheDocument();
    });

    it('shows check icon when account number is copied', () => {
      render(
        <DvaModal
          data={mockDvaData}
          copiedText="1234567890"
          onCopyToClipboard={mockOnCopyToClipboard}
          onClose={mockOnClose}
          formatCurrency={(amount) => `₦${amount.toLocaleString()}`}
          isVerifying={false}
          onConfirmTransfer={mockOnConfirmTransfer}
        />
      );

      // Find the button with check icon
      const buttons = screen.getAllByRole('button');
      const checkButton = buttons.find((button) =>
        button.querySelector('svg')?.classList.contains('lucide-check')
      );

      expect(checkButton).toBeInTheDocument();
    });

    it('calls onCopyToClipboard with account number when copy button is clicked', () => {
      renderDvaModal(mockDvaData, null);

      // Find and click the copy button
      const buttons = screen.getAllByRole('button');
      const copyButton = buttons.find((button) =>
        button.querySelector('svg')?.classList.contains('lucide-copy')
      );

      if (copyButton) {
        fireEvent.click(copyButton);
      }

      expect(mockOnCopyToClipboard).toHaveBeenCalledWith('1234567890');
      expect(mockOnCopyToClipboard).toHaveBeenCalledTimes(1);
    });

    it('does not show check icon when a different text is copied', () => {
      render(
        <DvaModal
          data={mockDvaData}
          copiedText="different-text"
          onCopyToClipboard={mockOnCopyToClipboard}
          onClose={mockOnClose}
          formatCurrency={(amount) => `₦${amount.toLocaleString()}`}
          isVerifying={false}
          onConfirmTransfer={mockOnConfirmTransfer}
        />
      );

      // Should show copy icon, not check
      const buttons = screen.getAllByRole('button');
      const copyButton = buttons.find((button) =>
        button.querySelector('svg')?.classList.contains('lucide-copy')
      );
      const checkButton = buttons.find((button) =>
        button.querySelector('svg')?.classList.contains('lucide-check')
      );

      expect(copyButton).toBeInTheDocument();
      expect(checkButton).toBeUndefined();
    });
  });

  describe('Close Functionality', () => {
    it('calls onClose when X button is clicked', () => {
      renderDvaModal(mockDvaData, null);

      // Find the X button in the header
      const buttons = screen.getAllByRole('button');
      const closeButton = buttons.find((button) =>
        button.querySelector('svg')?.classList.contains('lucide-x')
      );

      if (closeButton) {
        fireEvent.click(closeButton);
      }

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when "Close and check later" button is clicked', () => {
      renderDvaModal(mockDvaData, null);

      const closeButton = screen.getByRole('button', {
        name: /close and check later/i,
      });

      fireEvent.click(closeButton);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Confirm Transfer Button', () => {
    it('renders "Confirm Transfer Sent" button', () => {
      renderDvaModal(mockDvaData, null);

      expect(
        screen.getByRole('button', { name: /confirm transfer sent/i })
      ).toBeInTheDocument();
    });

    it('runs transfer verification when "Confirm Transfer Sent" is clicked', () => {
      renderDvaModal(mockDvaData, null);

      const confirmButton = screen.getByRole('button', {
        name: /confirm transfer sent/i,
      });

      fireEvent.click(confirmButton);

      expect(mockOnConfirmTransfer).toHaveBeenCalledTimes(1);
    });
  });

  describe('Edge Cases', () => {
    it('handles large amounts correctly', () => {
      const largeAmountData: DvaData = {
        ...mockDvaData,
        amount: 9999999,
      };

      renderDvaModal(largeAmountData, null);

      expect(screen.getByText('₦9,999,999')).toBeInTheDocument();
    });

    it('handles small amounts correctly', () => {
      const smallAmountData: DvaData = {
        ...mockDvaData,
        amount: 100,
      };

      renderDvaModal(smallAmountData, null);

      expect(screen.getByText('₦100')).toBeInTheDocument();
    });

    it('handles long account names with truncation styling', () => {
      const longNameData: DvaData = {
        ...mockDvaData,
        account_name: 'Very Long Account Name That Should Be Truncated',
      };

      renderDvaModal(longNameData, null);

      expect(
        screen.getByText('Very Long Account Name That Should Be Truncated')
      ).toBeInTheDocument();
    });

    it('handles special characters in reference', () => {
      const specialRefData: DvaData = {
        ...mockDvaData,
        reference: 'REF-2024-01-15_SPECIAL#123',
      };

      renderDvaModal(specialRefData, null);

      expect(
        screen.getByText('Reference: REF-2024-01-15_SPECIAL#123')
      ).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('renders modal with proper backdrop', () => {
      const { container } = renderDvaModal(mockDvaData, null);

      const backdrop = container.querySelector('.bg-black\\/50');
      expect(backdrop).toBeInTheDocument();
    });

    it('has all interactive buttons with proper type attribute', () => {
      renderDvaModal(mockDvaData, null);

      const buttons = screen.getAllByRole('button');
      buttons.forEach((button) => {
        expect(button).toHaveAttribute('type', 'button');
      });
    });
  });
});
