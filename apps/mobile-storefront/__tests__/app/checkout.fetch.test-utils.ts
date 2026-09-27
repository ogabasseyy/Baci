export function createCheckoutFetchMock() {
  return jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const requestUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (requestUrl.includes('/api/shipping/locations?state=')) {
      const state = new URL(
        requestUrl,
        'https://example.test'
      ).searchParams.get('state');
      const locationsByState = {
        Abuja: [
          { city: 'Abuja', state: 'Abuja' },
          { city: 'Garki', state: 'Abuja' },
        ],
        Lagos: [
          { city: 'Lagos', state: 'Lagos' },
          { city: 'Ikeja', state: 'Lagos' },
        ],
      } satisfies Record<string, Array<{ city: string; state: string }>>;
      const locationState =
        state === 'Abuja' || state === 'Lagos' ? state : null;

      return {
        json: async () => ({
          locations: locationState ? locationsByState[locationState] : [],
        }),
        ok: true,
      } as Response;
    }

    if (requestUrl.includes('/api/shipping/locations')) {
      return {
        json: async () => ({ states: ['Lagos', 'Abuja'] }),
        ok: true,
      } as Response;
    }

    if (requestUrl.includes('/api/shipping/quotes')) {
      return {
        json: async () => ({ quotes: { all: [] } }),
        ok: true,
      } as Response;
    }

    if (requestUrl.includes('/api/payments/initialize')) {
      // Bank-transfer initializations request a DVA (payment_type: 'dva')
      // and the initializer validates the returned virtual account
      // details before routing; mirror a complete account so legacy
      // bank-transfer fallbacks can reach their destination screen.
      let paymentType: unknown;
      try {
        const rawBody = init?.body;
        paymentType =
          typeof rawBody === 'string'
            ? (JSON.parse(rawBody) as { payment_type?: unknown }).payment_type
            : undefined;
      } catch {
        paymentType = undefined;
      }
      return {
        json: async () => ({
          authorization_url: 'https://checkout.paystack.com/order-1',
          reference: 'ref-order-1',
          success: true,
          ...(paymentType === 'dva'
            ? {
                dva: {
                  account_name: 'Test Account',
                  account_number: '0123456789',
                  bank_name: 'Test Bank',
                },
              }
            : {}),
        }),
        ok: true,
      } as Response;
    }

    return {
      json: async () => ({}),
      ok: true,
    } as Response;
  });
}
