import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const save = vi.hoisted(() => vi.fn());
const context = vi.hoisted(() => ({
  merchant: { id: 'merchant' } as { id: string } | null,
}));
const seed = { pixelId: 'pixel', capiConfigured: true };

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
  useMerchant: () => context,
}));

import ChatgptIntegrationPage from './client-page';

afterEach(() => {
  context.merchant = { id: 'merchant' };
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe('ChatGPT integration setup', () => {
  it('renders server-provided settings immediately without an initial browser request', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(
      <ChatgptIntegrationPage
        initialMerchantId="merchant"
        initialConnection={seed}
      />
    );
    expect(screen.getByDisplayValue('pixel')).toBeInTheDocument();
    expect(screen.getByText('Server key saved')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('clears entered secrets on merchant switches and reloads the original store instead of reusing its seed', async () => {
    let completeOther!: (response: Response) => void;
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            completeOther = resolve;
          })
      )
      .mockResolvedValueOnce(
        Response.json({ pixelId: 'updated-pixel', capiConfigured: false })
      );
    vi.stubGlobal('fetch', fetch);
    const view = render(
      <ChatgptIntegrationPage
        initialMerchantId="merchant"
        initialConnection={seed}
      />
    );
    fireEvent.change(screen.getByLabelText('Conversions API key'), {
      target: { value: 'unsaved-secret' },
    });
    context.merchant = { id: 'other' };
    view.rerender(
      <ChatgptIntegrationPage
        initialMerchantId="merchant"
        initialConnection={seed}
      />
    );
    expect(
      screen.queryByDisplayValue('unsaved-secret')
    ).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('pixel')).not.toBeInTheDocument();
    const signal = fetch.mock.calls[0][1].signal as AbortSignal;
    context.merchant = { id: 'merchant' };
    view.rerender(
      <ChatgptIntegrationPage
        initialMerchantId="merchant"
        initialConnection={seed}
      />
    );
    expect(signal.aborted).toBe(true);
    expect(
      await screen.findByDisplayValue('updated-pixel')
    ).toBeInTheDocument();
    await act(async () => {
      completeOther(
        Response.json({ pixelId: 'other-pixel', capiConfigured: true })
      );
    });
    expect(screen.queryByDisplayValue('other-pixel')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Conversions API key')).toHaveValue('');
    expect(fetch.mock.calls[1][0]).toContain('merchantId=merchant');
  });
  it('shows configuration separately from event verification without exposing a saved key', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ pixelId: 'pixel', capiConfigured: true })
        )
    );
    render(
      <ChatgptIntegrationPage
        initialMerchantId="merchant"
        initialConnection={seed}
      />
    );
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
    render(
      <ChatgptIntegrationPage
        initialMerchantId="merchant"
        initialConnection={seed}
      />
    );
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
    context.merchant = { id: 'other' };
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
    render(
      <ChatgptIntegrationPage
        initialMerchantId="merchant"
        initialConnection={seed}
      />
    );
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
    render(
      <ChatgptIntegrationPage
        initialMerchantId="merchant"
        initialConnection={seed}
      />
    );
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
    render(
      <ChatgptIntegrationPage
        initialMerchantId="merchant"
        initialConnection={seed}
      />
    );
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
    context.merchant = { id: 'other' };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ pixelId: 123, capiConfigured: 'yes' })
        )
    );
    render(
      <ChatgptIntegrationPage
        initialMerchantId="merchant"
        initialConnection={seed}
      />
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load'
    );
  });
});
