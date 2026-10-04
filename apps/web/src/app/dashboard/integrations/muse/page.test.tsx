import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUseMerchant, mockFetchWithCsrf } = vi.hoisted(() => ({
  mockUseMerchant: vi.fn(),
  mockFetchWithCsrf: vi.fn(),
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: mockUseMerchant,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (...args: unknown[]) => mockFetchWithCsrf(...args),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: PropsWithChildren<{ href: string }>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import MuseIntegrationPage from './page';

const MERCHANT_ID = '123e4567-e89b-42d3-a456-426614174001';
const BRANCH_ID = '123e4567-e89b-42d3-a456-426614174003';

const OWNER_ACCESS = {
  isStaff: false,
  isOwner: true,
  role: null,
  permissions: {},
};

const STAFF_ACCESS = {
  isStaff: true,
  isOwner: false,
  role: 'manager',
  permissions: {},
};

const grant = {
  grantId: '123e4567-e89b-42d3-a456-426614174004',
  connectionId: 'muse_conn_1',
  merchantId: MERCHANT_ID,
  branchIds: [],
  merchantWide: true,
  scopes: ['orders:read', 'inventory:read'],
  status: 'active',
  version: 1,
  expiresAt: '2026-11-01T12:00:00.000Z',
  usable: true,
};

function mockGetResponses(statusBody: unknown) {
  global.fetch = vi.fn(async (url: unknown) => {
    if (String(url).startsWith('/api/branches')) {
      return new Response(
        JSON.stringify({
          branches: [{ id: BRANCH_ID, name: 'Lagos main', is_default: true }],
        }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify(statusBody), { status: 200 });
  }) as unknown as typeof fetch;
}

describe('dashboard Muse integration page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseMerchant.mockReturnValue({
      merchant: { id: MERCHANT_ID },
      staffAccess: OWNER_ACCESS,
      loading: false,
    });
    mockGetResponses({ connections: [] });
    mockFetchWithCsrf.mockResolvedValue(
      new Response(JSON.stringify({ connections: [] }), {
        status: 200,
      })
    );
  });

  it.each([
    'network',
    'json',
    'http',
  ])('reports branch %s failures without an unhandled rejection', async (failure) => {
    global.fetch = vi.fn(async (url: unknown) => {
      if (String(url).startsWith('/api/branches')) {
        if (failure === 'network') throw new Error('network unavailable');
        if (failure === 'json') return new Response('{', { status: 200 });
        return new Response('{}', { status: 500 });
      }
      return new Response(JSON.stringify({ connections: [] }), { status: 200 });
    }) as typeof fetch;
    render(<MuseIntegrationPage />);
    expect(
      await screen.findByText('Could not load the merchant branches.')
    ).toBeInTheDocument();
  });

  it('shows connector status as unavailable when the initial status read fails', async () => {
    global.fetch = vi.fn(async (url: unknown) => {
      if (String(url).startsWith('/api/branches')) {
        return new Response(JSON.stringify({ branches: [] }), { status: 200 });
      }
      return new Response('{}', { status: 503 });
    }) as typeof fetch;

    render(<MuseIntegrationPage />);

    expect(await screen.findByText('Unavailable')).toBeInTheDocument();
    expect(
      screen.getByText('Could not load the connector status.')
    ).toBeInTheDocument();
  });

  it('provides an accessible name for the integrations navigation link', async () => {
    mockGetResponses({ connections: [] });
    render(<MuseIntegrationPage />);
    expect(
      await screen.findByRole('link', { name: 'Back to integrations' })
    ).toBeInTheDocument();
  });

  it('shows an expired label for an expired active connection', async () => {
    mockGetResponses({
      connections: [
        { ...grant, usable: false, expiresAt: '2020-01-01T00:00:00Z' },
      ],
    });
    render(<MuseIntegrationPage />);
    expect(await screen.findByText('expired')).toBeInTheDocument();
  });

  it('gates the interface to owners in the UI', async () => {
    mockUseMerchant.mockReturnValue({
      merchant: { id: MERCHANT_ID },
      staffAccess: STAFF_ACCESS,
      loading: false,
    });

    render(<MuseIntegrationPage />);

    expect(await screen.findByText('Owners only')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /connect muse/i })
    ).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('shows the connect form with read-only scopes when disconnected', async () => {
    render(<MuseIntegrationPage />);

    expect(
      await screen.findByRole('button', { name: /connect muse/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/read-only scopes/i)).toBeInTheDocument();
    for (const scope of ['orders:read', 'inventory:read', 'analytics:read']) {
      expect(
        screen.getByText(new RegExp(scope.replace(':', '\\:')))
      ).toBeInTheDocument();
    }
  });

  it('connects with the selected scope and shows one-time credentials', async () => {
    render(<MuseIntegrationPage />);
    const connectButton = await screen.findByRole('button', {
      name: /connect muse/i,
    });

    mockFetchWithCsrf.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          alreadyConnected: false,
          refreshToken: 'mcn_refresh_abc',
          token: 'mcn_abc',
        }),
        { status: 201 }
      )
    );
    fireEvent.click(connectButton);

    expect(
      await screen.findByText('Copy your connector credentials')
    ).toBeInTheDocument();
    expect(screen.getByText('mcn_abc')).toBeInTheDocument();
    const [, init] = mockFetchWithCsrf.mock.calls[0] as [
      string,
      { body: string; method: string },
    ];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({
      merchantId: MERCHANT_ID,
      merchantWide: true,
    });
    expect(JSON.parse(init.body).connectionId).toEqual(expect.any(String));
    await waitFor(() => expect(connectButton).toBeEnabled());
    mockFetchWithCsrf.mockResolvedValueOnce(
      new Response('{}', { status: 500 })
    );
    fireEvent.click(connectButton);
    await waitFor(() => expect(connectButton).toBeEnabled());
    expect(mockFetchWithCsrf).toHaveBeenCalledTimes(2);
    expect(screen.getByText('mcn_abc')).toBeInTheDocument();
  });

  it('keeps one-time credentials when the status refresh fails', async () => {
    mockGetResponses({ connections: [grant] });
    render(<MuseIntegrationPage />);
    expect(await screen.findByText('Connected (1)')).toBeInTheDocument();
    const connectButton = await screen.findByRole('button', {
      name: /connect muse/i,
    });

    mockFetchWithCsrf.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          alreadyConnected: true,
          reissued: true,
          refreshToken: 'mcn_refresh_xyz',
          token: 'mcn_xyz',
        }),
        { status: 200 }
      )
    );
    global.fetch = vi.fn(async (url: unknown) => {
      if (String(url).startsWith('/api/branches')) {
        return new Response(JSON.stringify({ branches: [] }), {
          status: 200,
        });
      }
      throw new Error('status outage');
    }) as unknown as typeof fetch;
    fireEvent.click(connectButton);

    expect(
      await screen.findByText('Copy your connector credentials')
    ).toBeInTheDocument();
    expect(screen.getByText('mcn_xyz')).toBeInTheDocument();
    expect(
      screen.getByText('Could not load the connector status.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Connected (1)')).not.toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });

  it('keeps credentials when an unrelated connection disconnects', async () => {
    const NEW_GRANT_ID = '123e4567-e89b-42d3-a456-426614174006';
    const newGrant = {
      ...grant,
      grantId: NEW_GRANT_ID,
      connectionId: 'muse_conn_new',
    };
    mockGetResponses({ connections: [grant] });
    render(<MuseIntegrationPage />);
    const connectButton = await screen.findByRole('button', {
      name: /connect muse/i,
    });

    mockFetchWithCsrf.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          alreadyConnected: false,
          grant: { grantId: NEW_GRANT_ID },
          refreshToken: 'mcn_refresh_new',
          token: 'mcn_new',
        }),
        { status: 201 }
      )
    );
    mockGetResponses({ connections: [grant, newGrant] });
    fireEvent.click(connectButton);
    expect(
      await screen.findByText('Copy your connector credentials')
    ).toBeInTheDocument();

    // Disconnecting the older grant keeps the new pair on screen.
    const disconnectButtons = await screen.findAllByRole('button', {
      name: /^disconnect$/i,
    });
    expect(disconnectButtons).toHaveLength(2);
    fireEvent.click(disconnectButtons[0]);
    const confirmOld = await screen.findByRole('button', {
      name: /confirm disconnect/i,
    });
    mockFetchWithCsrf.mockResolvedValueOnce(
      new Response(JSON.stringify({ revoked: true }), { status: 200 })
    );
    mockGetResponses({ connections: [newGrant] });
    fireEvent.click(confirmOld);
    expect(await screen.findByText('Connected (1)')).toBeInTheDocument();
    expect(screen.getByText('mcn_new')).toBeInTheDocument();

    // Disconnecting the grant that produced the pair clears it.
    const [lastDisconnect] = screen.getAllByRole('button', {
      name: /^disconnect$/i,
    });
    fireEvent.click(lastDisconnect);
    const confirmNew = await screen.findByRole('button', {
      name: /confirm disconnect/i,
    });
    mockFetchWithCsrf.mockResolvedValueOnce(
      new Response(JSON.stringify({ revoked: true }), { status: 200 })
    );
    mockGetResponses({ connections: [] });
    fireEvent.click(confirmNew);
    await screen.findByText('Connect Muse', { selector: 'button' });
    expect(
      screen.queryByText('Copy your connector credentials')
    ).not.toBeInTheDocument();
  });

  it('lists every connection and disconnects one with confirmation', async () => {
    const secondGrant = {
      ...grant,
      grantId: '123e4567-e89b-42d3-a456-426614174005',
      connectionId: 'muse_conn_2',
      scopes: ['analytics:read'],
    };
    mockGetResponses({ connections: [grant, secondGrant] });
    render(<MuseIntegrationPage />);

    expect(await screen.findByText('Connected (2)')).toBeInTheDocument();
    expect(screen.getAllByText('Entire merchant')).toHaveLength(2);
    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(screen.getByText('Analytics')).toBeInTheDocument();
    // Never renders credential material.
    expect(screen.queryByText(/token_hash/i)).not.toBeInTheDocument();

    const disconnectButtons = screen.getAllByRole('button', {
      name: /^disconnect$/i,
    });
    expect(disconnectButtons).toHaveLength(2);
    fireEvent.click(disconnectButtons[1]);
    const confirm = await screen.findByRole('button', {
      name: /confirm disconnect/i,
    });
    mockFetchWithCsrf.mockResolvedValueOnce(
      new Response(JSON.stringify({ revoked: true }), { status: 200 })
    );
    mockGetResponses({ connections: [grant] });
    fireEvent.click(confirm);

    expect(await screen.findByText('Connected (1)')).toBeInTheDocument();
    const [url, init] = mockFetchWithCsrf.mock.calls[0] as [
      string,
      { body: string; method: string },
    ];
    expect(url).toBe('/api/integrations/muse');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body)).toMatchObject({
      merchantId: MERCHANT_ID,
      grantId: secondGrant.grantId,
    });
  });

  it('shows not connected after the last connection is removed', async () => {
    mockGetResponses({ connections: [grant] });
    render(<MuseIntegrationPage />);
    await screen.findByText('Connected (1)');

    fireEvent.click(screen.getByRole('button', { name: /^disconnect$/i }));
    const confirm = await screen.findByRole('button', {
      name: /confirm disconnect/i,
    });
    mockFetchWithCsrf.mockResolvedValueOnce(
      new Response(JSON.stringify({ revoked: true }), { status: 200 })
    );
    mockGetResponses({ connections: [] });
    fireEvent.click(confirm);

    expect(await screen.findByText('Not connected')).toBeInTheDocument();
  });
  it('reuses the request ID after an indeterminate failure and replaces it after success', async () => {
    render(<MuseIntegrationPage />);
    const button = await screen.findByRole('button', { name: /connect muse/i });
    mockFetchWithCsrf.mockRejectedValueOnce(new Error('response lost'));
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeEnabled());
    mockFetchWithCsrf.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          token: 'mcn_retry',
          refreshToken: 'refresh_retry',
          grant,
        }),
        { status: 201 }
      )
    );
    fireEvent.click(button);
    await screen.findByText('mcn_retry');
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(mockFetchWithCsrf).toHaveBeenCalledTimes(3));
    const ids = mockFetchWithCsrf.mock.calls.map(
      ([, init]) => JSON.parse(init.body).connectionId
    );
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it('clears credentials and connection state when the merchant changes', async () => {
    mockGetResponses({ connections: [grant] });
    const view = render(<MuseIntegrationPage />);
    const button = await screen.findByRole('button', { name: /connect muse/i });
    mockFetchWithCsrf.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          token: 'mcn_old_store',
          refreshToken: 'refresh_old',
          grant,
        }),
        { status: 201 }
      )
    );
    fireEvent.click(button);
    await screen.findByText('mcn_old_store');
    mockUseMerchant.mockReturnValue({
      merchant: { id: 'another-merchant' },
      staffAccess: OWNER_ACCESS,
      loading: false,
    });
    global.fetch = vi.fn().mockRejectedValue(new Error('new merchant offline'));
    view.rerender(<MuseIntegrationPage />);
    expect(screen.queryByText('mcn_old_store')).not.toBeInTheDocument();
    expect(screen.queryByText('Connected (1)')).not.toBeInTheDocument();
    await screen.findByText('Status unavailable');
  });

  it('ignores a connect response arriving after a merchant switch', async () => {
    let complete: (response: Response) => void = () => {};
    mockFetchWithCsrf.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        })
    );
    const view = render(<MuseIntegrationPage />);
    fireEvent.click(
      await screen.findByRole('button', { name: /connect muse/i })
    );
    mockUseMerchant.mockReturnValue({
      merchant: { id: 'another-merchant' },
      staffAccess: OWNER_ACCESS,
      loading: false,
    });
    view.rerender(<MuseIntegrationPage />);
    complete(
      new Response(
        JSON.stringify({
          token: 'mcn_late_old_store',
          refreshToken: 'refresh_old',
          grant,
        }),
        { status: 201 }
      )
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /connect muse/i })
      ).toBeEnabled()
    );
    expect(screen.queryByText('mcn_late_old_store')).not.toBeInTheDocument();
  });
});
