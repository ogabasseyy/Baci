import {
  CheckoutPage,
  expect,
  it,
  render,
  screen,
  usePersistedState,
  useSearchParams,
  vi,
  waitFor,
} from './checkout-page-test-support';

it('wraps the resume-error state in the OgaBassey checkout scope', async () => {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams({
      gateway: 'credpal',
      orderId: 'ord-1',
      trackingToken: 'tok-123',
    }) as unknown as ReturnType<typeof useSearchParams>
  );
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: false,
    json: async () => ({}),
  } as Response);

  try {
    render(<CheckoutPage />);

    const errorRoot = await screen
      .findByText(/something went wrong/i)
      .then((node) => node.closest('.ogabassey-checkout-page'));

    expect(errorRoot).toBeInTheDocument();
  } finally {
    fetchMock.mockRestore();
  }
});

it('includes merchant_slug and tracking token when resuming an order', async () => {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams({
      orderId: 'ord-1',
      gateway: 'credpal',
      trackingToken: 'tok-123',
    }) as unknown as ReturnType<typeof useSearchParams>
  );

  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: false,
    json: async () => ({}),
  } as Response);

  render(<CheckoutPage />);

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/storefront/orders/ord-1?merchant_slug=ogabassey&token=tok-123',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  fetchMock.mockRestore();
});

it('includes a persisted customer email alongside the tracking token when resuming an order', async () => {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams({
      orderId: 'ord-1',
      gateway: 'credpal',
      trackingToken: 'tok-123',
    }) as unknown as ReturnType<typeof useSearchParams>
  );
  vi.mocked(usePersistedState).mockReturnValue([
    {
      orderId: 'ord-1',
      merchantId: 'merchant-1',
      customerEmail: 'resume@example.com',
      customerPhone: '+2348012345678',
      checkoutFingerprint: 'fingerprint',
      amountDueToGateway: 1000,
      createdAt: '2026-04-18T00:00:00.000Z',
    },
    vi.fn(),
    vi.fn(),
  ] as unknown as ReturnType<typeof usePersistedState>);

  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: false,
    json: async () => ({}),
  } as Response);

  render(<CheckoutPage />);

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/storefront/orders/ord-1?merchant_slug=ogabassey&token=tok-123&email=resume%40example.com',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  fetchMock.mockRestore();
});

it('falls back to the persisted customer email for legacy resume links without a token', async () => {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams({
      orderId: 'ord-1',
      gateway: 'credpal',
    }) as unknown as ReturnType<typeof useSearchParams>
  );
  vi.mocked(usePersistedState).mockReturnValue([
    {
      orderId: 'ord-1',
      merchantId: 'merchant-1',
      customerEmail: 'legacy@example.com',
      customerPhone: '+2348012345678',
      checkoutFingerprint: 'fingerprint',
      amountDueToGateway: 1000,
      createdAt: '2026-04-18T00:00:00.000Z',
    },
    vi.fn(),
    vi.fn(),
  ] as unknown as ReturnType<typeof usePersistedState>);

  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: false,
    json: async () => ({}),
  } as Response);

  render(<CheckoutPage />);

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/storefront/orders/ord-1?merchant_slug=ogabassey&email=legacy%40example.com',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  fetchMock.mockRestore();
});
