import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RedemptionSuccessDialog } from './redemption-success-dialog';

const mockToast = vi.fn();

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const RESULT = {
  code: 'RDM-ABC123',
  instructions: 'Apply this code at checkout.',
  expiresAt: '2026-11-09T00:00:00.000Z',
};

describe('RedemptionSuccessDialog', () => {
  it('renders the code, instructions, and formatted expiry', () => {
    render(
      <RedemptionSuccessDialog
        open={true}
        onOpenChange={() => {}}
        result={RESULT}
      />
    );

    expect(screen.getByText('RDM-ABC123')).toBeInTheDocument();
    expect(
      screen.getByText('Apply this code at checkout.')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `Expires: ${new Date(RESULT.expiresAt).toLocaleDateString('en-NG', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })}`,
        { exact: false }
      )
    ).toBeInTheDocument();
  });

  it('copies the code and toasts on copy click', () => {
    mockToast.mockClear();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    render(
      <RedemptionSuccessDialog
        open={true}
        onOpenChange={() => {}}
        result={RESULT}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Copy redemption code' })
    );

    expect(writeText).toHaveBeenCalledWith('RDM-ABC123');
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Copied!',
      description: 'Redemption code copied to clipboard',
    });
    vi.unstubAllGlobals();
  });

  it('closes through onOpenChange on Done', () => {
    const onOpenChange = vi.fn();

    render(
      <RedemptionSuccessDialog
        open={true}
        onOpenChange={onOpenChange}
        result={RESULT}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
