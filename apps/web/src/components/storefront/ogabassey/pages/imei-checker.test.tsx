import { IMEI_SERVICE_TIERS, type ImeiServiceTierKey } from '@baci/shared/imei';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OgabasseyImeiChecker } from './imei-checker';
import { getDisplayTier } from './imei-checker-tiers';

const fetchMock = vi.fn();
const mocks = vi.hoisted(() => ({ useMerchantSafe: vi.fn() }));

vi.stubGlobal('fetch', fetchMock);

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => (
    // biome-ignore lint/a11y/useAltText: alt is spread from props.
    // biome-ignore lint/performance/noImgElement: test stub for next/image.
    <img {...props} alt={String(props.alt ?? '')} />
  ),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: mocks.useMerchantSafe,
}));

describe('OgabasseyImeiChecker', () => {
  beforeEach(() => {
    document.cookie = 'csrf-token=test-csrf-token; path=/';
    fetchMock.mockReset();
    mocks.useMerchantSafe.mockReturnValue({
      basePath: '/ogabassey',
      merchant: { slug: 'ogabassey' },
    });
  });

  const getFetchHeaders = (callIndex: number) => {
    const init = fetchMock.mock.calls[callIndex]?.[1] as
      | { headers?: HeadersInit }
      | undefined;

    return new Headers(init?.headers);
  };

  // Some tiers (e.g. 'activation') accept both IMEI and Apple serial, which
  // changes the input's accessible label/placeholder — match either.
  const enterValidImei = () => {
    fireEvent.change(screen.getByRole('textbox', { name: /imei|serial/i }), {
      target: { value: '354442067957452' },
    });
  };

  const successfulImeiResponse = {
    success: true,
    data: {
      imei: '354442067957452',
      device: 'iPhone 15 Pro',
      modelNumber: 'A3101',
      status: 'Clean',
      icloud: 'Off',
      icloudLock: 'Off',
      simLock: 'Unlocked',
      blacklistStatus: 'Clean',
      carrier: 'Unlocked',
      deviceImage: '',
      score: 98,
      deviceType: 'apple',
      verdict: 'Safe to buy',
      verdictType: 'safe',
    },
  };

  const tierButtonName = (tierKey: ImeiServiceTierKey) => {
    const tier = getDisplayTier(tierKey);
    return `${tier.name}, ${tier.tagline}, ${tier.priceDisplay}`;
  };

  it('renders the primary smartphone tiers accepted by the API', () => {
    render(<OgabasseyImeiChecker />);

    const selectedTierRadio = screen.getByRole('radio', {
      name: tierButtonName('full'),
    });
    expect(selectedTierRadio).toHaveAttribute('aria-checked', 'true');

    expect(selectedTierRadio).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: tierButtonName('basic') })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: tierButtonName('blacklist') })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: tierButtonName('carrier') })
    ).toBeInTheDocument();
    expect(screen.getByText('Quick ID')).toBeInTheDocument();
  });

  it('posts IMEI checks with an idempotency key', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(successfulImeiResponse),
    });

    render(<OgabasseyImeiChecker />);

    enterValidImei();
    fireEvent.click(screen.getByRole('button', { name: /verify now/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { body: string; method: string },
    ];
    const headers = getFetchHeaders(0);

    expect(url).toBe('/api/storefront/imei-check');
    expect(init.method).toBe('POST');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('x-csrf-token')).toBe('test-csrf-token');
    expect(headers.get('idempotency-key')).toEqual(
      expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      )
    );
    expect(JSON.parse(init.body)).toMatchObject({
      clientCapabilities: ['imei-async-v1'],
      device: 'smartphone',
      imei: '354442067957452',
      merchantSlug: 'ogabassey',
      tier: 'full',
    });
    expect(await screen.findByText('iPhone 15 Pro')).toBeInTheDocument();
    expect(screen.getByText('Safe to buy')).toBeInTheDocument();
  });

  it('clears the stale sign-in action when merchant context disappears', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ success: false, error: 'Unauthorized' }),
    });
    const { rerender } = render(<OgabasseyImeiChecker />);
    enterValidImei();
    fireEvent.click(screen.getByRole('button', { name: /verify now/i }));
    await screen.findByRole('link', { name: /sign in/i });
    mocks.useMerchantSafe.mockReturnValue(null);
    rerender(<OgabasseyImeiChecker />);
    fireEvent.click(screen.getByRole('button', { name: /verify now/i }));
    await screen.findByText(/storefront is unavailable/i);
    expect(screen.queryByRole('link', { name: /sign in/i })).toBeNull();
  });

  it('shows an error instead of silently dropping submission without merchant context', async () => {
    mocks.useMerchantSafe.mockReturnValue(null);
    render(<OgabasseyImeiChecker />);

    enterValidImei();
    fireEvent.click(screen.getByRole('button', { name: /verify now/i }));

    expect(
      await screen.findByText(/storefront is unavailable/i)
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the pending state and polls an async check to completion', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: vi.fn().mockResolvedValue({
          lookupId: '11111111-1111-4111-8111-111111111111',
          pollAfterMs: 0,
          status: 'pending',
          success: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          ...successfulImeiResponse,
          status: 'complete',
        }),
      });

    render(<OgabasseyImeiChecker />);

    enterValidImei();
    fireEvent.click(screen.getByRole('button', { name: /verify now/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      /usually under a minute/i
    );
    expect(await screen.findByText('iPhone 15 Pro')).toBeInTheDocument();
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      '/api/storefront/imei-check/11111111-1111-4111-8111-111111111111?merchantSlug=ogabassey'
    );
  });

  it.each([
    ['activation', 'activation'],
    ['blacklist', 'blacklist'],
    ['carrier', 'carrier'],
  ] as const)('posts the selected %s tier', async (_label, expectedTier) => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(successfulImeiResponse),
    });

    render(<OgabasseyImeiChecker />);

    if (expectedTier === 'activation')
      fireEvent.click(screen.getByRole('button', { name: 'More checks' }));
    fireEvent.click(
      screen.getByRole('radio', { name: tierButtonName(expectedTier) })
    );
    enterValidImei();
    fireEvent.click(screen.getByRole('button', { name: /verify now/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    const [, init] = fetchMock.mock.calls[0] as [
      string,
      { body: string; method: string },
    ];

    expect(JSON.parse(init.body)).toMatchObject({
      imei: '354442067957452',
      tier: expectedTier,
    });
  });

  it('reuses the idempotency key when retrying the same IMEI and tier', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(successfulImeiResponse),
      });

    render(<OgabasseyImeiChecker />);

    enterValidImei();
    fireEvent.click(screen.getByRole('button', { name: /verify now/i }));

    expect(
      await screen.findByText(
        'Network error. Please check your connection and try again.'
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /verify now/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const firstHeaders = getFetchHeaders(0);
    const secondHeaders = getFetchHeaders(1);

    expect(secondHeaders.get('idempotency-key')).toBe(
      firstHeaders.get('idempotency-key')
    );
    expect(await screen.findByText('iPhone 15 Pro')).toBeInTheDocument();
  });

  it('creates a fresh idempotency key after a terminal API response', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 402,
        json: vi.fn().mockResolvedValue({
          success: false,
          code: 'WALLET_INSUFFICIENT',
          error: 'Wallet balance is too low.',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(successfulImeiResponse),
      });

    render(<OgabasseyImeiChecker />);

    enterValidImei();
    fireEvent.click(screen.getByRole('button', { name: /verify now/i }));

    // 402 always renders the dedicated top-up copy, not the raw API message.
    expect(
      await screen.findByText(/insufficient wallet balance/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /verify now/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const firstHeaders = getFetchHeaders(0);
    const secondHeaders = getFetchHeaders(1);

    expect(secondHeaders.get('idempotency-key')).not.toBe(
      firstHeaders.get('idempotency-key')
    );
    expect(await screen.findByText('iPhone 15 Pro')).toBeInTheDocument();
  });

  it('offers sign-in with a return to the checker after an expired session', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ success: false, error: 'Unauthorized' }),
    });
    render(<OgabasseyImeiChecker />);
    enterValidImei();
    fireEvent.click(screen.getByRole('button', { name: /verify now/i }));
    expect(
      await screen.findByRole('link', { name: /sign in/i })
    ).toHaveAttribute(
      'href',
      '/ogabassey/account/login?redirect=%2Fogabassey%2Fimei-check'
    );
    expect(
      screen.queryByRole('link', { name: /fund wallet/i })
    ).not.toBeInTheDocument();
  });

  it('links to the wallet funding flow when the wallet balance is insufficient', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 402,
      json: vi.fn().mockResolvedValue({
        success: false,
        code: 'WALLET_INSUFFICIENT',
        error: 'Wallet balance is too low.',
      }),
    });

    render(<OgabasseyImeiChecker />);

    enterValidImei();
    fireEvent.click(screen.getByRole('button', { name: /verify now/i }));

    expect(
      await screen.findByText(/insufficient wallet balance/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /fund wallet/i })).toHaveAttribute(
      'href',
      '/ogabassey/wallet?fund=1'
    );
  });

  it('preserves the idempotency key while a refund is pending', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: vi.fn().mockResolvedValue({
          success: false,
          code: 'REFUND_PENDING',
          error: 'Refund is being processed.',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(successfulImeiResponse),
      });

    render(<OgabasseyImeiChecker />);

    enterValidImei();
    fireEvent.click(screen.getByRole('button', { name: /verify now/i }));

    // The REFUND_PENDING branch always renders its own fixed copy, not the
    // raw API message.
    expect(
      await screen.findByText(
        'Lookup failed; your refund is pending. We will credit you within 24h.'
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /verify now/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const firstHeaders = getFetchHeaders(0);
    const secondHeaders = getFetchHeaders(1);

    expect(secondHeaders.get('idempotency-key')).toBe(
      firstHeaders.get('idempotency-key')
    );
    expect(await screen.findByText('iPhone 15 Pro')).toBeInTheDocument();
  });

  it('preserves the idempotency key while the original request is in flight', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({
          success: false,
          code: 'IDEMPOTENT_REQUEST_IN_FLIGHT',
          error: 'This IMEI lookup is still processing.',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(successfulImeiResponse),
      });

    render(<OgabasseyImeiChecker />);

    enterValidImei();
    fireEvent.click(screen.getByRole('button', { name: /verify now/i }));

    expect(
      await screen.findByText('This IMEI lookup is still processing.')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /verify now/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const firstHeaders = getFetchHeaders(0);
    const secondHeaders = getFetchHeaders(1);

    expect(secondHeaders.get('idempotency-key')).toBe(
      firstHeaders.get('idempotency-key')
    );
    expect(await screen.findByText('iPhone 15 Pro')).toBeInTheDocument();
  });

  it.each([
    [
      'DEBIT_FAILURE_STATE_SAVE_FAILED',
      'Lookup failed and debit failure state could not be saved.',
    ],
    [
      'LOOKUP_RESULT_SAVE_FAILED',
      'IMEI lookup completed but the result could not be saved.',
    ],
    [
      'REFUND_STATE_SAVE_FAILED',
      'Lookup failed and refund status could not be saved.',
    ],
    [
      'REFUNDED_STATE_SAVE_FAILED',
      'Lookup failed and refund result could not be saved.',
    ],
  ])('preserves the idempotency key after unresolved recovery failure %s', async (code, message) => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({
          success: false,
          code,
          error: message,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(successfulImeiResponse),
      });

    render(<OgabasseyImeiChecker />);

    enterValidImei();
    fireEvent.click(screen.getByRole('button', { name: /verify now/i }));

    expect(await screen.findByText(message)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /verify now/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const firstHeaders = getFetchHeaders(0);
    const secondHeaders = getFetchHeaders(1);

    expect(secondHeaders.get('idempotency-key')).toBe(
      firstHeaders.get('idempotency-key')
    );
    expect(await screen.findByText('iPhone 15 Pro')).toBeInTheDocument();
  });

  it('shows the API error message when an IMEI check fails', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({
        success: false,
        error: 'Wallet balance is too low.',
      }),
    });

    render(<OgabasseyImeiChecker />);

    enterValidImei();
    fireEvent.click(screen.getByRole('button', { name: /verify now/i }));

    expect(
      await screen.findByText('Wallet balance is too low.')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /fund wallet/i })
    ).not.toBeInTheDocument();
  });

  it('shows sign-in copy when the check requires authentication', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({ success: false }),
    });

    render(<OgabasseyImeiChecker />);

    enterValidImei();
    fireEvent.click(screen.getByRole('button', { name: /verify now/i }));

    expect(
      await screen.findByText('Please sign in to check this device.')
    ).toBeInTheDocument();
  });

  it('shows a top-up amount when the wallet balance is insufficient', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 402,
      json: vi.fn().mockResolvedValue({
        success: false,
        balance: 200,
        required: 1000,
      }),
    });

    render(<OgabasseyImeiChecker />);

    enterValidImei();
    fireEvent.click(screen.getByRole('button', { name: /verify now/i }));

    expect(
      await screen.findByText(/insufficient wallet balance/i)
    ).toBeInTheDocument();
    expect(await screen.findByText(/₦800/)).toBeInTheDocument();
  });

  it('shows a network error when the IMEI request rejects', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));

    render(<OgabasseyImeiChecker />);

    enterValidImei();
    fireEvent.click(screen.getByRole('button', { name: /verify now/i }));

    expect(
      await screen.findByText(
        'Network error. Please check your connection and try again.'
      )
    ).toBeInTheDocument();
  });

  it('keeps invalid IMEI submissions disabled', () => {
    render(<OgabasseyImeiChecker />);

    const submitButton = screen.getByRole('button', { name: /verify now/i });

    fireEvent.change(screen.getByPlaceholderText(/enter 15-digit imei/i), {
      target: { value: '35444206795745' },
    });

    expect(submitButton).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('disables the submit button while an IMEI check is in flight', async () => {
    let resolveRequest: (response: {
      ok: true;
      status: number;
      json: () => Promise<typeof successfulImeiResponse>;
    }) => void = () => undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        })
    );

    render(<OgabasseyImeiChecker />);

    enterValidImei();
    const submitButton = screen.getByRole('button', { name: /verify now/i });
    fireEvent.click(submitButton);

    await waitFor(() => expect(submitButton).toBeDisabled());

    resolveRequest({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(successfulImeiResponse),
    });

    expect(await screen.findByText('iPhone 15 Pro')).toBeInTheDocument();
  });

  it('renders the result against the tier that was actually requested, not a tier picked after the request was submitted', async () => {
    let resolveRequest: (response: {
      ok: true;
      status: number;
      json: () => Promise<typeof successfulImeiResponse>;
    }) => void = () => undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        })
    );

    render(<OgabasseyImeiChecker />);

    enterValidImei();
    fireEvent.click(screen.getByRole('button', { name: /verify now/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    // Nothing disables the device tabs while the request is in flight — the
    // user switches to Mac (a very different tier: 'macIcloud') before the
    // 'full' report they actually paid for comes back.
    fireEvent.click(screen.getByRole('tab', { name: /mac checks/i }));

    resolveRequest({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(successfulImeiResponse),
    });

    expect(await screen.findByText('Full Report Report')).toBeInTheDocument();
    expect(screen.getByText('Blacklist Status')).toBeInTheDocument();
    expect(screen.getByText('SIM Lock')).toBeInTheDocument();
  });

  it('does not submit a request when the imei fails validation for the current identifier', () => {
    render(<OgabasseyImeiChecker />);

    // Bypass the disabled submit button entirely and dispatch a raw form
    // submit — regression test for handleCheck's own guard, not just the
    // button's disabled state.
    fireEvent.change(screen.getByPlaceholderText(/enter 15-digit imei/i), {
      target: { value: '354442067957453' }, // 15 digits, fails the Luhn check
    });
    fireEvent.submit(
      screen
        .getByRole('button', { name: /verify now/i })
        .closest('form') as HTMLFormElement
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks the error banner as an alert for assistive technology', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({
        success: false,
        error: 'Wallet balance is too low.',
      }),
    });

    render(<OgabasseyImeiChecker />);

    enterValidImei();
    fireEvent.click(screen.getByRole('button', { name: /verify now/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Wallet balance is too low.'
    );
  });

  it('moves focus to the result when a check succeeds, and back to the form after reset', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(successfulImeiResponse),
    });

    render(<OgabasseyImeiChecker />);

    enterValidImei();
    fireEvent.click(screen.getByRole('button', { name: /verify now/i }));

    await screen.findByText('iPhone 15 Pro');
    // Focus runs in the result component's effect, after the new report mounts.
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).toHaveAttribute('tabindex', '-1');
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      /full report report ready/i
    );

    fireEvent.click(
      screen.getByRole('button', { name: /check another device/i })
    );

    // Focus runs in the remounted entry form's effect, after the result unmounts.
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).toHaveAttribute('tabindex', '-1');
    });
    expect(
      screen.getByRole('textbox', { name: /search for a device name/i })
    ).toBeInTheDocument();
  });

  it('switches to the tablet device tab and resets the tier selection', () => {
    render(<OgabasseyImeiChecker />);

    const phoneTab = screen.getByRole('tab', { name: /phone checks/i });
    const phonePanel = screen.getByRole('tabpanel', { name: /phone checks/i });
    expect(phoneTab.getAttribute('aria-controls')).toBe(phonePanel.id);
    fireEvent.click(screen.getByRole('tab', { name: /ipad checks/i }));
    const tabletPanel = screen.getByRole('tabpanel', { name: /ipad checks/i });
    expect(tabletPanel.id).toBe(phonePanel.id);

    const recommended = IMEI_SERVICE_TIERS.activation;
    expect(
      screen.getByRole('radio', {
        name: tierButtonName('activation'),
      })
    ).toHaveAttribute('aria-checked', 'true');
    expect(recommended.deviceCategories).toContain('tablet');
    expect(
      screen.queryByRole('radiogroup', { name: /brand/i })
    ).not.toBeInTheDocument();
  });
});
