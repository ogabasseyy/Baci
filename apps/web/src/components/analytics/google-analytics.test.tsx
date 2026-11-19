import { act, render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleAnalytics } from './google-analytics';

vi.mock('next/script', () => ({
  default: ({
    id,
    src,
    children,
  }: {
    id?: string;
    src?: string;
    children?: ReactNode;
  }) => (
    <script id={id} data-src={src} type="text/plain">
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** gtag() pushes its `arguments` object, which is array-like but not an array. */
function isArrayLike(value: unknown): value is ArrayLike<unknown> {
  return isRecord(value) && 'length' in value;
}

async function runInlineConfigScript(): Promise<Record<string, unknown>> {
  const { container } = render(<GoogleAnalytics measurementId="G-TEST123" />);
  await waitFor(() =>
    expect(container.querySelector('script#google-analytics')).not.toBeNull()
  );
  const source = container.querySelector(
    'script#google-analytics'
  )?.textContent;
  if (!source) throw new Error('The inline GA config script has no text');
  new Function(source)();
  const queue: unknown = window.dataLayer;
  const entries: unknown[] = Array.isArray(queue) ? queue : [];
  const command = entries.find(
    (entry): entry is ArrayLike<unknown> =>
      isArrayLike(entry) && entry[0] === 'config'
  );
  const config = command?.[2];
  if (!isRecord(config)) {
    throw new Error('The GA script queued no config command');
  }
  return config;
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
    'G-ABC 123',
    'G-ABC"123',
    'AW-ab',
    `G-${'A'.repeat(41)}`,
    '',
  ])('renders no script for the invalid id %j', async (id) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { container } = render(<GoogleAnalytics measurementId={id} />);
    // Flush the initialization microtask before asserting nothing rendered.
    await act(async () => {});

    expect(container.querySelector('script')).toBeNull();
    if (id) {
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).not.toContain(id);
    } else {
      expect(warn).not.toHaveBeenCalled();
    }
  });

  it.each([
    'G-ABC12345',
    'GT-ABC1234',
    'AW-123456789',
    'DC-1234567',
    'G-ABC-123',
  ])('renders the scripts for the Google tag id %s', async (id) => {
    const { container } = render(<GoogleAnalytics measurementId={id} />);

    await waitFor(() =>
      expect(container.querySelector('script#google-analytics')).not.toBeNull()
    );
    expect(
      container.querySelector('script#google-analytics')?.textContent
    ).toContain(JSON.stringify(id));
    expect(
      container.querySelector('script[data-src]')?.getAttribute('data-src')
    ).toBe(`https://www.googletagmanager.com/gtag/js?id=${id}`);
  });

  it('still renders the config for a valid GA4 id', async () => {
    const config = await runInlineConfigScript();

    expect(config).toHaveProperty('page_location');
  });
});
