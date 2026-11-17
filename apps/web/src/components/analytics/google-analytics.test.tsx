import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleAnalytics } from './google-analytics';

vi.mock('next/script', () => ({
  default: ({ id, children }: { id?: string; children?: ReactNode }) => (
    <script id={id} type="text/plain">
      {children}
    </script>
  ),
}));
vi.mock('@/lib/consent-mode', () => ({
  applyStoredConsent: vi.fn(),
  initializeConsentMode: vi.fn(),
}));

afterEach(() => {
  Reflect.deleteProperty(window, 'dataLayer');
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

async function runInlineConfigScript(): Promise<Record<string, unknown>> {
  const { container } = render(<GoogleAnalytics measurementId="G-TEST123" />);
  await waitFor(() =>
    expect(container.querySelector('script#google-analytics')).not.toBeNull()
  );
  const source = container.querySelector('script#google-analytics')
    ?.textContent as string;
  new Function(source)();
  const entries = (window.dataLayer ?? []) as ArrayLike<unknown>[];
  const config = entries.find((entry) => entry[0] === 'config');
  return config?.[2] as Record<string, unknown>;
}

describe('GoogleAnalytics inline config', () => {
  it('sends page_location without order tokens or shopper details', async () => {
    window.history.replaceState(
      null,
      '',
      '/track-order?token=abc&email=a%40b.c&orderId=1#top'
    );

    const config = await runInlineConfigScript();

    expect(config.page_location).toBe(
      `${window.location.origin}/track-order?orderId=1`
    );
  });

  it('sends page_referrer without order tokens or shopper details', async () => {
    vi.spyOn(document, 'referrer', 'get').mockReturnValue(
      'https://shop.example/order-success?trackingToken=abc&orderId=9'
    );

    const config = await runInlineConfigScript();

    expect(config.page_referrer).toBe(
      'https://shop.example/order-success?orderId=9'
    );
  });

  it('omits page_referrer when there is no referrer', async () => {
    const config = await runInlineConfigScript();

    expect(config.page_referrer).toBeUndefined();
  });
});

describe('bugfix: measurement id was interpolated into the inline script unchecked', () => {
  it.each([
    "G-ABC123');alert(1);//",
    'G-ABC`+1+`',
    'UA-1234-5',
    '',
  ])('renders no script for the invalid id %j', async (id) => {
    const { container } = render(<GoogleAnalytics measurementId={id} />);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(container.querySelector('script')).toBeNull();
  });

  it('still renders the config for a valid GA4 id', async () => {
    const config = await runInlineConfigScript();

    expect(config).toBeDefined();
  });
});
