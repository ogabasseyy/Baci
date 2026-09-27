import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockToast = vi.fn();

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({ toast: mockToast })),
}));

const mockDiscoverJumiaShops = vi.fn();
const mockConnectJumiaShops = vi.fn();

vi.mock('./use-jumia-integrations', () => ({
  discoverJumiaShops: (...args: unknown[]) => mockDiscoverJumiaShops(...args),
  connectJumiaShops: (...args: unknown[]) => mockConnectJumiaShops(...args),
}));

import { ConnectJumiaDialog } from './connect-jumia-dialog';

describe('ConnectJumiaDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onConnected: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it('renders the dialog title when open', () => {
    render(<ConnectJumiaDialog {...defaultProps} />);

    expect(
      screen.getByRole('heading', { name: /connect jumia account/i })
    ).toBeInTheDocument();
  });

  it('renders the OAuth connect button as a link', () => {
    render(<ConnectJumiaDialog {...defaultProps} />);

    expect(
      screen.getByText(/recommended for continuous and background sync/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/web application oauth/i)).toBeInTheDocument();
    expect(
      screen.getByText(/temporary.*re-login after.*token expires/i)
    ).toBeInTheDocument();

    const link = screen.getByRole('link', { name: /connect with jumia/i });
    expect(link).toHaveAttribute(
      'href',
      '/api/marketplace/jumia/connect?connectionType=oauth'
    );
  });

  it('shows manual form fields after clicking the toggle button', async () => {
    const user = userEvent.setup();
    render(<ConnectJumiaDialog {...defaultProps} />);

    await user.click(
      screen.getByRole('button', { name: /enter refresh token/i })
    );

    expect(screen.getByLabelText(/client id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/refresh token/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /discover shops/i })
    ).toBeInTheDocument();
  });

  it('discovers shops and connects selected shops on success', async () => {
    mockDiscoverJumiaShops.mockResolvedValueOnce({
      ok: true,
      discoveryId: '00000000-0000-4000-8000-000000000099',
      shops: [
        {
          id: 'shop-1',
          name: 'My Shop',
          countryCode: 'NG',
          marketplace: 'Jumia Nigeria',
          alreadyConnected: false,
        },
      ],
    });
    mockConnectJumiaShops.mockResolvedValueOnce({ ok: true });

    const user = userEvent.setup();
    render(<ConnectJumiaDialog {...defaultProps} />);

    await user.click(
      screen.getByRole('button', { name: /enter refresh token/i })
    );
    await user.type(screen.getByLabelText(/client id/i), 'client-id');
    await user.type(screen.getByLabelText(/refresh token/i), 'valid-token');
    await user.click(screen.getByRole('button', { name: /discover shops/i }));

    await waitFor(() => {
      expect(mockDiscoverJumiaShops).toHaveBeenCalledWith(
        'client-id',
        'valid-token',
        undefined
      );
    });

    expect(
      screen.getByRole('button', { name: /connect 0 shops/i })
    ).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /my shop/i }));
    await user.click(screen.getByRole('button', { name: /connect 1 shop/i }));

    await waitFor(() => {
      expect(mockConnectJumiaShops).toHaveBeenCalledWith(
        'client-id',
        '00000000-0000-4000-8000-000000000099',
        ['shop-1']
      );
    });

    expect(mockToast).toHaveBeenCalledWith({
      title: 'Jumia account connected successfully!',
    });
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
    expect(defaultProps.onConnected).toHaveBeenCalled();
  });

  it('shows destructive toast on discovery failure', async () => {
    mockDiscoverJumiaShops.mockResolvedValueOnce({
      ok: false,
      error: 'Invalid token',
    });

    const user = userEvent.setup();
    render(<ConnectJumiaDialog {...defaultProps} />);

    await user.click(
      screen.getByRole('button', { name: /enter refresh token/i })
    );
    await user.type(screen.getByLabelText(/client id/i), 'client-id');
    await user.type(screen.getByLabelText(/refresh token/i), 'bad-token');
    await user.click(screen.getByRole('button', { name: /discover shops/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Discovery failed',
        description: 'Invalid token',
        variant: 'destructive',
      });
    });
    expect(
      screen.queryByRole('button', { name: /connect \d+ shop/i })
    ).not.toBeInTheDocument();
  });

  it('shows destructive toast when connection fails and keeps the dialog open', async () => {
    mockDiscoverJumiaShops.mockResolvedValueOnce({
      ok: true,
      discoveryId: '00000000-0000-4000-8000-000000000099',
      shops: [
        {
          id: 'shop-1',
          name: 'My Shop',
          countryCode: 'NG',
          marketplace: 'Jumia Nigeria',
          alreadyConnected: false,
        },
      ],
    });
    mockConnectJumiaShops.mockResolvedValueOnce({
      ok: false,
      error: 'Invalid token',
    });

    const user = userEvent.setup();
    render(<ConnectJumiaDialog {...defaultProps} />);

    await user.click(
      screen.getByRole('button', { name: /enter refresh token/i })
    );
    await user.type(screen.getByLabelText(/client id/i), 'client-id');
    await user.type(screen.getByLabelText(/refresh token/i), 'valid-token');
    await user.click(screen.getByRole('button', { name: /discover shops/i }));
    await user.click(screen.getByRole('checkbox', { name: /my shop/i }));
    await user.click(screen.getByRole('button', { name: /connect 1 shop/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Connection failed',
        description: 'Invalid token',
        variant: 'destructive',
      });
    });
    expect(defaultProps.onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('shows destructive toast when discovery returns no shops', async () => {
    mockDiscoverJumiaShops.mockResolvedValueOnce({
      ok: true,
      discoveryId: '00000000-0000-4000-8000-000000000099',
      shops: [],
    });

    const user = userEvent.setup();
    render(<ConnectJumiaDialog {...defaultProps} />);

    await user.click(
      screen.getByRole('button', { name: /enter refresh token/i })
    );
    await user.type(screen.getByLabelText(/client id/i), 'client-id');
    await user.type(screen.getByLabelText(/refresh token/i), 'valid-token');
    await user.click(screen.getByRole('button', { name: /discover shops/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'No shops found',
        description: 'Jumia did not return any shops for this authorization.',
        variant: 'destructive',
      });
    });
  });

  it('disables already-connected shops and excludes them from connect payload', async () => {
    mockDiscoverJumiaShops.mockResolvedValueOnce({
      ok: true,
      discoveryId: '00000000-0000-4000-8000-000000000099',
      shops: [
        {
          id: 'shop-1',
          name: 'New Shop',
          countryCode: 'NG',
          marketplace: 'Jumia Nigeria',
          alreadyConnected: false,
        },
        {
          id: 'shop-2',
          name: 'Existing Shop',
          countryCode: 'NG',
          marketplace: 'Jumia Nigeria',
          alreadyConnected: true,
        },
      ],
    });
    mockConnectJumiaShops.mockResolvedValueOnce({ ok: true });

    const user = userEvent.setup();
    render(<ConnectJumiaDialog {...defaultProps} />);

    await user.click(
      screen.getByRole('button', { name: /enter refresh token/i })
    );
    await user.type(screen.getByLabelText(/client id/i), 'client-id');
    await user.type(screen.getByLabelText(/refresh token/i), 'valid-token');
    await user.click(screen.getByRole('button', { name: /discover shops/i }));

    const connectedCheckbox = screen.getByRole('checkbox', {
      name: /existing shop/i,
    });
    expect(connectedCheckbox).toBeChecked();
    expect(connectedCheckbox).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: /new shop/i }));
    await user.click(screen.getByRole('button', { name: /connect 1 shop/i }));

    await waitFor(() => {
      expect(mockConnectJumiaShops).toHaveBeenCalledWith(
        'client-id',
        '00000000-0000-4000-8000-000000000099',
        ['shop-1']
      );
    });
  });

  it('clears form fields when dialog is dismissed', () => {
    render(<ConnectJumiaDialog {...defaultProps} />);

    const dialogContent = screen.getByRole('dialog');
    expect(dialogContent).toBeInTheDocument();
    fireEvent.keyDown(dialogContent, { key: 'Escape' });
    expect(defaultProps.onOpenChange).toHaveBeenCalled();
  });

  it('does not render dialog content when open is false', () => {
    render(<ConnectJumiaDialog {...defaultProps} open={false} />);

    expect(
      screen.queryByRole('heading', { name: /connect jumia account/i })
    ).not.toBeInTheDocument();
  });
});
