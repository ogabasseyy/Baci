import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CartHandoff } from './cart-handoff';

const TOKEN = 'ch1.test-payload.test-signature';
const HANDOFF_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    cartId: '22222222-2222-4222-8222-222222222222',
    currency: 'NGN',
    estimatedTotals: false,
    expiresAt: '2026-10-19T04:00:00Z',
    lines: [
      {
        id: 'line-1',
        item: { productId: '44444444-4444-4444-8444-444444444444' },
        lineTotalMinor: 1500,
        quantity: 1,
        unitPriceMinor: 1500,
      },
    ],
    merchantId: '11111111-1111-4111-8111-111111111111',
    state: 'active',
    subtotalMinor: 1500,
    totalMinor: 1500,
    version: 3,
    ...overrides,
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status });
}

const fetchMock = vi.fn();

function mockFetchSequence(
  previewPayload: unknown,
  destPayload: unknown,
  destStatus = 200
) {
  fetchMock.mockImplementation(async (url: string | URL) => {
    const href = String(url);
    if (href.includes('/api/storefront/cart/handoff?')) {
      return jsonResponse(previewPayload);
    }
    if (href.includes('/api/storefront/cart?')) {
      return jsonResponse(destPayload, destStatus);
    }
    throw new Error(`unexpected fetch ${href}`);
  });
}

const replaceMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState(null, '', '/cart');
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, pathname: '/cart', replace: replaceMock },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CartHandoff', () => {
  it('strips the pairing fragment before fetching by public id', async () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    window.history.replaceState(
      null,
      '',
      `/cart#handoff=${TOKEN}&hid=${HANDOFF_ID}`
    );
    mockFetchSequence(
      {
        expiresAt: '2026-10-12T06:05:00.000Z',
        merchant: {
          id: '11111111-1111-4111-8111-111111111111',
          slug: 'ogabassey',
        },
        snapshot: snapshot(),
        status: 'pending',
        warnings: [],
      },
      { code: 'not_found' },
      404
    );

    render(<CartHandoff handoffId={HANDOFF_ID} token={TOKEN} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(replaceState).toHaveBeenCalledWith(null, '', '/cart');
    for (const [url, init] of fetchMock.mock.calls as [
      string,
      Record<string, unknown>,
    ][]) {
      expect(url).not.toContain('ch1.');
      expect(init?.referrerPolicy).toBe('no-referrer');
    }
    expect(fetchMock.mock.calls[0]?.[0]).toContain(`handoff_id=${HANDOFF_ID}`);
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it('renders the continuation preview for an approved merchant', async () => {
    mockFetchSequence(
      {
        expiresAt: '2026-10-12T06:05:00.000Z',
        merchant: {
          id: '11111111-1111-4111-8111-111111111111',
          slug: 'ogabassey',
        },
        snapshot: snapshot(),
        status: 'pending',
        warnings: [],
      },
      { code: 'not_found' },
      404
    );

    render(<CartHandoff handoffId={HANDOFF_ID} token={TOKEN} />);

    expect(await screen.findByText(/ogabassey/i)).toBeInTheDocument();
    expect(await screen.findByText(/1 item/i)).toBeInTheDocument();
  });

  it('connects a fresh destination and navigates to the clean cart', async () => {
    mockFetchSequence(
      {
        expiresAt: '2026-10-12T06:05:00.000Z',
        merchant: {
          id: '11111111-1111-4111-8111-111111111111',
          slug: 'ogabassey',
        },
        snapshot: snapshot(),
        status: 'pending',
        warnings: [],
      },
      { code: 'not_found' },
      404
    );
    let releaseRedeem!: (response: Response) => void;
    const redeemGate = new Promise<Response>((resolve) => {
      releaseRedeem = resolve;
    });
    fetchMock.mockImplementation(async (url: string | URL) => {
      const href = String(url);
      if (href.includes('/api/storefront/cart/handoff/redeem')) {
        return redeemGate;
      }
      if (href.includes('/api/storefront/cart/handoff?')) {
        return jsonResponse({
          expiresAt: '2026-10-12T06:05:00.000Z',
          merchant: {
            id: '11111111-1111-4111-8111-111111111111',
            slug: 'ogabassey',
          },
          snapshot: snapshot(),
          status: 'pending',
          warnings: [],
        });
      }
      return jsonResponse({ code: 'not_found' }, 404);
    });

    render(<CartHandoff handoffId={HANDOFF_ID} token={TOKEN} />);

    const connect = await screen.findByRole('button', { name: /connect/i });
    fireEvent.click(connect);

    // The attempt identifier is persisted before the response lands, so a
    // second click while the request is in flight replays the same attempt.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes('/handoff/redeem')
        )
      ).toBe(true)
    );
    const redeemCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/handoff/redeem')
    );
    expect(redeemCall).toBeDefined();
    const body = JSON.parse(String((redeemCall?.[1] as RequestInit).body));
    expect(body).toMatchObject({
      attemptId: expect.any(String),
      choice: 'connect',
      expectedIncomingVersion: 3,
      handoffId: HANDOFF_ID,
      token: TOKEN,
    });
    expect(
      localStorage.getItem(`baci-cart-handoff-attempt:${HANDOFF_ID}`)
    ).toBe(body.attemptId);

    releaseRedeem(
      jsonResponse({
        cart: snapshot(),
        choice: 'connect',
        proof: 'cp1.new.session',
        replayed: false,
        warnings: [],
      })
    );
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/cart'));
    // A redeemed attempt is cleared so a stale identifier is never replayed.
    expect(
      localStorage.getItem(`baci-cart-handoff-attempt:${HANDOFF_ID}`)
    ).toBeNull();
  });

  it('offers merge and keep-existing when a destination cart exists', async () => {
    mockFetchSequence(
      {
        expiresAt: '2026-10-12T06:05:00.000Z',
        merchant: {
          id: '11111111-1111-4111-8111-111111111111',
          slug: 'ogabassey',
        },
        snapshot: snapshot(),
        status: 'pending',
        warnings: [],
      },
      { cart: snapshot({ cartId: 'dest-cart', version: 2 }), warnings: [] }
    );

    render(<CartHandoff handoffId={HANDOFF_ID} token={TOKEN} />);

    expect(
      await screen.findByRole('button', { name: /connect/i })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: /merge/i })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: /keep.*existing/i })
    ).toBeInTheDocument();
  });

  it('resolves merge conflicts with per-line choices on one attempt', async () => {
    const destCart = snapshot({
      cartId: 'dest-cart',
      lines: [
        {
          id: 'line-9',
          item: { productId: '44444444-4444-4444-8444-444444444444' },
          lineTotalMinor: 2200,
          negotiatedUnitPriceMinor: 2200,
          negotiationStatus: 'accepted',
          quantity: 1,
          unitPriceMinor: 1500,
        },
      ],
      version: 2,
    });
    const incomingCart = snapshot({
      lines: [
        {
          id: 'line-1',
          item: { productId: '44444444-4444-4444-8444-444444444444' },
          lineTotalMinor: 2000,
          negotiatedUnitPriceMinor: 2000,
          negotiationStatus: 'accepted',
          quantity: 1,
          unitPriceMinor: 1500,
        },
      ],
    });
    fetchMock.mockImplementation(async (url: string | URL) => {
      const href = String(url);
      if (href.includes('/api/storefront/cart/handoff/redeem')) {
        return jsonResponse({
          cart: destCart,
          choice: 'merge',
          proof: 'cp1.merged.session',
          replayed: false,
          warnings: [],
        });
      }
      if (href.includes('/api/storefront/cart/handoff?')) {
        return jsonResponse({
          expiresAt: '2026-10-12T06:05:00.000Z',
          merchant: {
            id: '11111111-1111-4111-8111-111111111111',
            slug: 'ogabassey',
          },
          snapshot: incomingCart,
          status: 'pending',
          warnings: [],
        });
      }
      return jsonResponse({ cart: destCart, warnings: [] });
    });

    render(<CartHandoff handoffId={HANDOFF_ID} token={TOKEN} />);

    fireEvent.click(await screen.findByRole('button', { name: /merge/i }));
    expect(
      await screen.findByRole('heading', { name: /choose what to keep/i })
    ).toBeInTheDocument();
    // The first click plans locally and persists the attempt without
    // posting; the resolution screen reuses that same attempt identifier.
    const persistedAttempt = localStorage.getItem(
      `baci-cart-handoff-attempt:${HANDOFF_ID}`
    );
    expect(persistedAttempt).toEqual(expect.any(String));
    const incomingChoice = await screen.findByRole('radio', {
      name: /incoming/i,
    });
    fireEvent.click(incomingChoice);
    fireEvent.click(
      await screen.findByRole('button', {
        name: /continue.*merge|merge.*select/i,
      })
    );

    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    const redeemCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/handoff/redeem')
    );
    expect(redeemCalls).toHaveLength(1);
    const body = JSON.parse(String((redeemCalls[0]?.[1] as RequestInit).body));
    expect(body.resolutions).toEqual([
      {
        item: { productId: '44444444-4444-4444-8444-444444444444' },
        keep: 'incoming',
      },
    ]);
    expect(body.attemptId).toBe(persistedAttempt);
    expect(
      localStorage.getItem(`baci-cart-handoff-attempt:${HANDOFF_ID}`)
    ).toBeNull();
  });

  it('explains consumed and expired links without redeeming', async () => {
    for (const status of ['consumed', 'expired'] as const) {
      vi.clearAllMocks();
      mockFetchSequence(
        {
          expiresAt: '2026-10-12T06:05:00.000Z',
          merchant: null,
          snapshot: null,
          status,
          warnings: [],
        },
        { code: 'not_found' },
        404
      );

      const { unmount } = render(
        <CartHandoff handoffId={HANDOFF_ID} token={TOKEN} />
      );
      expect(
        await screen.findByText(
          status === 'consumed' ? /already used/i : /expired/i
        )
      ).toBeInTheDocument();
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes('/handoff/redeem')
        )
      ).toBe(false);
      unmount();
    }
  });
});

describe('new guest handoff', () => {
  it('bootstraps only after the guest explicitly connects and scopes redemption to the merchant', async () => {
    fetchMock.mockImplementation(async (url: string | URL) => {
      const href = String(url);
      if (href.includes('/handoff?'))
        return jsonResponse({
          merchant: { slug: 'ogabassey' },
          snapshot: snapshot(),
          status: 'pending',
        });
      if (href.includes('/cart?'))
        return jsonResponse({ code: 'missing_proof' }, 401);
      if (href.includes('/bootstrap'))
        return jsonResponse({ proof: 'bootstrap-proof' }, 201);
      if (href.includes('/redeem')) return jsonResponse({ ok: true });
      throw new Error(`unexpected fetch ${href}`);
    });
    render(<CartHandoff handoffId={HANDOFF_ID} token={TOKEN} />);
    const connect = await screen.findByRole('button', { name: /connect/i });
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/bootstrap'))
    ).toBe(false);
    fireEvent.click(connect);
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toContain('/api/storefront/cart/bootstrap');
    expect(urls).toContain(
      '/api/storefront/cart/handoff/redeem?merchantSlug=ogabassey'
    );
    expect(urls.findIndex((url) => url.includes('/bootstrap'))).toBeLessThan(
      urls.findIndex((url) => url.includes('/redeem'))
    );
  });

  it('does not treat a destination lookup outage as an empty cart', async () => {
    mockFetchSequence(
      {
        merchant: { slug: 'ogabassey' },
        snapshot: snapshot(),
        status: 'pending',
      },
      { code: 'temporarily_unavailable' },
      503
    );
    render(<CartHandoff handoffId={HANDOFF_ID} token={TOKEN} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole('button', { name: /connect/i })
    ).not.toBeInTheDocument();
  });
});

it('recovers a temporary destination outage without discarding the handoff', async () => {
  const preview = {
    merchant: { slug: 'ogabassey' },
    snapshot: snapshot(),
    status: 'pending',
  };
  mockFetchSequence(preview, { code: 'temporarily_unavailable' }, 503);
  render(<CartHandoff handoffId={HANDOFF_ID} token={TOKEN} />);
  expect(
    await screen.findByRole('heading', { name: 'We could not check your cart' })
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('heading', { name: 'This cart link ended' })
  ).not.toBeInTheDocument();
  mockFetchSequence(preview, { code: 'missing_proof' }, 401);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(
    await screen.findByRole('button', { name: /connect/i })
  ).toBeInTheDocument();
  expect(
    fetchMock.mock.calls.some(([url]) => String(url).includes('/bootstrap'))
  ).toBe(false);
});
