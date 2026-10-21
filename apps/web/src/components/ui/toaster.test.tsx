import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseToast = vi.fn();
let shouldFailToastImport = false;

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => mockUseToast(),
}));

vi.mock('@/components/ui/toast', () => {
  if (shouldFailToastImport) {
    throw new Error('chunk load failed');
  }
  return {
    Toast: ({ children }: { children: ReactNode }) => (
      <div data-testid="radix-toast">{children}</div>
    ),
    ToastClose: () => <button type="button">Close</button>,
    ToastDescription: ({ children }: { children: ReactNode }) => (
      <div>{children}</div>
    ),
    ToastProvider: ({ children }: { children: ReactNode }) => (
      <div>{children}</div>
    ),
    ToastTitle: ({ children }: { children: ReactNode }) => (
      <div>{children}</div>
    ),
    ToastViewport: () => <div data-testid="radix-toast-viewport" />,
  };
});

describe('Toaster', () => {
  beforeEach(() => {
    vi.resetModules();
    mockUseToast.mockReset();
    shouldFailToastImport = false;
  });

  it('renders nothing on initial mount when there are no active toasts', async () => {
    mockUseToast.mockReturnValue({ toasts: [] });
    const { Toaster } = await import('./toaster');

    const { container } = render(<Toaster />);

    expect(container.firstChild).toBeNull();
  });

  it('renders an immediate fallback toast while the toast chunk resolves and upgrades to the full Toast provider', async () => {
    mockUseToast.mockReturnValue({
      toasts: [
        {
          id: 'toast-1',
          open: true,
          title: 'Added to cart',
          description: 'Galaxy Z Fold8 is in your bag.',
        },
      ],
    });
    const { Toaster } = await import('./toaster');

    render(<Toaster />);

    expect(screen.getByText('Added to cart')).toBeInTheDocument();
    expect(
      screen.getByText('Galaxy Z Fold8 is in your bag.')
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('radix-toast')).toBeInTheDocument();
    });
  });

  it('retries loading the toast module when a single toast is replaced after an initial import failure', async () => {
    const dismiss = vi.fn();
    shouldFailToastImport = true;
    mockUseToast.mockReturnValue({
      dismiss,
      toasts: [
        {
          id: 'toast-1',
          open: true,
          title: 'First error',
        },
      ],
    });
    const { Toaster } = await import('./toaster');

    const { rerender } = render(<Toaster />);
    expect(screen.getByText('First error')).toBeInTheDocument();
    screen.getByRole('button', { name: 'Close' }).click();
    expect(dismiss).toHaveBeenCalledWith('toast-1');

    shouldFailToastImport = false;
    mockUseToast.mockReturnValue({
      dismiss,
      toasts: [
        {
          id: 'toast-2',
          open: true,
          title: 'Second toast',
        },
      ],
    });
    rerender(<Toaster />);

    await waitFor(() => {
      expect(screen.getByTestId('radix-toast')).toBeInTheDocument();
    });
    expect(screen.getByText('Second toast')).toBeInTheDocument();
  });

  it('honors each fallback toast configured duration instead of dismissing early', async () => {
    vi.useFakeTimers();
    try {
      const dismiss = vi.fn();
      shouldFailToastImport = true;
      mockUseToast.mockReturnValue({
        dismiss,
        toasts: [
          {
            id: 'toast-long',
            duration: 8000,
            open: true,
            title: 'Draft recovered',
          },
        ],
      });
      const { Toaster } = await import('./toaster');

      render(<Toaster />);
      vi.advanceTimersByTime(2500);
      expect(dismiss).not.toHaveBeenCalled();

      vi.advanceTimersByTime(5500);
      expect(dismiss).toHaveBeenCalledWith('toast-long');
    } finally {
      vi.useRealTimers();
    }
  });
});
