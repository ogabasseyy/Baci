import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDiscoverJumiaShops = vi.fn();
const mockConnectJumiaShops = vi.fn();

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({ toast: vi.fn() })),
}));

vi.mock('./use-jumia-integrations', () => ({
  discoverJumiaShops: (...args: unknown[]) => mockDiscoverJumiaShops(...args),
  connectJumiaShops: (...args: unknown[]) => mockConnectJumiaShops(...args),
}));

import { ConnectJumiaDialog } from './connect-jumia-dialog';

describe('ConnectJumiaDialog resumable discovery', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onConnected: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it('preserves the opaque discovery while clearing the refresh credential', async () => {
    mockDiscoverJumiaShops.mockResolvedValueOnce({
      ok: true,
      discoveryId: '00000000-0000-4000-8000-000000000099',
      shops: [
        {
          id: 'shop-1',
          name: 'Resumable Shop',
          countryCode: 'NG',
          marketplace: 'Jumia Nigeria',
          alreadyConnected: false,
        },
      ],
    });

    const user = userEvent.setup();
    const { unmount } = render(<ConnectJumiaDialog {...defaultProps} />);

    await user.click(
      screen.getByRole('button', { name: /enter refresh token/i })
    );
    await user.type(screen.getByLabelText(/client id/i), 'client-id');
    await user.type(screen.getByLabelText(/refresh token/i), 'rotating-token');
    await user.click(screen.getByRole('button', { name: /discover shops/i }));
    await waitFor(() => {
      expect(screen.getByText('Resumable Shop')).toBeInTheDocument();
    });

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    unmount();
    render(<ConnectJumiaDialog {...defaultProps} />);

    expect(screen.getByLabelText(/client id/i)).toHaveValue('client-id');
    expect(
      screen.getByRole('button', { name: /discover shops/i })
    ).toBeEnabled();
    expect(screen.getByLabelText(/refresh token/i)).toHaveValue('');
  });

  it('retains resumable discovery state after connecting only part of the results', async () => {
    mockDiscoverJumiaShops.mockResolvedValueOnce({
      ok: true,
      discoveryId: '00000000-0000-4000-8000-000000000099',
      shops: [
        {
          id: 'shop-1',
          name: 'First Shop',
          countryCode: 'NG',
          marketplace: 'Jumia Nigeria',
          alreadyConnected: false,
        },
        {
          id: 'shop-2',
          name: 'Second Shop',
          countryCode: 'GH',
          marketplace: 'Jumia Ghana',
          alreadyConnected: false,
        },
      ],
    });
    mockConnectJumiaShops.mockResolvedValueOnce({
      ok: true,
      discoveryComplete: false,
    });

    const user = userEvent.setup();
    render(<ConnectJumiaDialog {...defaultProps} />);

    await user.click(
      screen.getByRole('button', { name: /enter refresh token/i })
    );
    await user.type(screen.getByLabelText(/client id/i), 'client-id');
    await user.type(screen.getByLabelText(/refresh token/i), 'valid-token');
    await user.click(screen.getByRole('button', { name: /discover shops/i }));
    await user.click(screen.getByRole('checkbox', { name: /first shop/i }));
    await user.click(screen.getByRole('button', { name: /connect 1 shop/i }));

    await waitFor(() => {
      expect(mockConnectJumiaShops).toHaveBeenCalled();
    });
    await user.click(
      screen.getByRole('button', { name: /enter refresh token/i })
    );

    expect(screen.getByLabelText(/client id/i)).toHaveValue('client-id');
    expect(screen.getByLabelText(/refresh token/i)).toHaveValue('');
    expect(screen.getByText('First Shop')).toBeInTheDocument();
    expect(screen.getByText('Second Shop')).toBeInTheDocument();
  });

  it('persists the recovery handle when discovery fails retryably', async () => {
    mockDiscoverJumiaShops.mockResolvedValueOnce({
      ok: false,
      error: 'Jumia rotated the token and timed out',
      discoveryId: '00000000-0000-4000-8000-000000000077',
      retryable: true,
    });

    const user = userEvent.setup();
    const { unmount } = render(<ConnectJumiaDialog {...defaultProps} />);

    await user.click(
      screen.getByRole('button', { name: /enter refresh token/i })
    );
    await user.type(screen.getByLabelText(/client id/i), 'client-id');
    await user.type(screen.getByLabelText(/refresh token/i), 'consumed-token');
    await user.click(screen.getByRole('button', { name: /discover shops/i }));
    await waitFor(() => {
      expect(mockDiscoverJumiaShops).toHaveBeenCalled();
    });

    unmount();
    render(<ConnectJumiaDialog {...defaultProps} />);

    expect(screen.getByLabelText(/client id/i)).toHaveValue('client-id');
    expect(
      screen.getByRole('button', { name: /discover shops/i })
    ).toBeEnabled();
    expect(screen.getByLabelText(/refresh token/i)).toHaveValue('');
  });
});
