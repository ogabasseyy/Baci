import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const save = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: save }));
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: import('react').AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    <span role="img" aria-label={alt} data-src={src} />
  ),
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: () => ({ merchant: { id: 'merchant' } }),
}));

import ChatgptIntegrationPage from './page';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe('ChatGPT integration setup', () => {
  it('shows configuration separately from event verification without exposing a saved key', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ pixelId: 'pixel', capiConfigured: true })
        )
    );
    render(<ChatgptIntegrationPage />);
    expect(await screen.findByDisplayValue('pixel')).toBeInTheDocument();
    expect(screen.getByText('Server key saved')).toBeInTheDocument();
    expect(
      screen.getByText(/Event delivery has not been verified/)
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Conversions API key')).toHaveValue('');
  });
  it('saves the merchant pixel ID and new server key', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ pixelId: null, capiConfigured: false })
        )
    );
    save.mockResolvedValue(
      Response.json({ pixelId: 'pixel', capiConfigured: true })
    );
    render(<ChatgptIntegrationPage />);
    await screen.findByLabelText('Pixel ID');
    fireEvent.change(screen.getByLabelText('Pixel ID'), {
      target: { value: 'pixel' },
    });
    fireEvent.change(screen.getByLabelText('Conversions API key'), {
      target: { value: 'new-secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save connection' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        '/api/integrations/chatgpt-ads?merchantId=merchant',
        expect.objectContaining({
          body: JSON.stringify({ pixelId: 'pixel', capiKey: 'new-secret' }),
        })
      )
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Conversions API key')).toHaveValue('')
    );
  });
  it('shows load failures instead of claiming a connection', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: 'Only the store owner can manage this connection.' },
            { status: 403 }
          )
        )
    );
    render(<ChatgptIntegrationPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load'
    );
  });
  it('shows save failures without claiming a saved connection', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ pixelId: 'pixel', capiConfigured: false })
        )
    );
    save.mockResolvedValue(
      Response.json({ error: 'save_failed' }, { status: 500 })
    );
    render(<ChatgptIntegrationPage />);
    await screen.findByDisplayValue('pixel');
    fireEvent.click(screen.getByRole('button', { name: 'Save connection' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save'
    );
    expect(
      screen.queryByText('Connection settings saved.')
    ).not.toBeInTheDocument();
  });
  it('disconnects a saved connection without sending a key', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ pixelId: 'pixel', capiConfigured: true })
        )
    );
    save.mockResolvedValue(
      Response.json({ pixelId: null, capiConfigured: false })
    );
    render(<ChatgptIntegrationPage />);
    await screen.findByDisplayValue('pixel');
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        '/api/integrations/chatgpt-ads?merchantId=merchant',
        expect.objectContaining({
          body: JSON.stringify({ pixelId: null, disconnect: true }),
        })
      )
    );
    expect(
      await screen.findByText('Server key not configured')
    ).toBeInTheDocument();
  });
  it('rejects malformed successful responses instead of displaying a connection', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ pixelId: 123, capiConfigured: 'yes' })
        )
    );
    render(<ChatgptIntegrationPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load'
    );
  });
});
