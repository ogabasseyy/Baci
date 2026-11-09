import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostHogPageviewTracker } from './posthog-pageview-tracker';

let pathname = '/';
let searchParams = new URLSearchParams();

const mocks = vi.hoisted(() => ({
  capturePostHogPageview: vi.fn(),
  capturePublicBlogPageview: vi.fn(),
  hasPostHogBrowserInitialized: vi.fn(() => false),
  initializePostHogBrowser: vi.fn(),
  resetPublicBlogPageviewDedupe: vi.fn(),
  resolvePublicBlogPageviewAttribution: vi.fn<
    () => {
      $referrer: string;
      $referring_domain: string;
      utm_source?: string;
      utm_medium?: string;
      utm_campaign?: string;
    } | null
  >(() => ({
    $referrer: '$direct',
    $referring_domain: '$direct',
  })),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => searchParams,
}));

vi.mock('@/lib/posthog/browser-state', () => ({
  hasPostHogBrowserInitialized: mocks.hasPostHogBrowserInitialized,
}));

vi.mock('@/lib/posthog/browser', () => ({
  capturePostHogPageview: mocks.capturePostHogPageview,
  initializePostHogBrowser: mocks.initializePostHogBrowser,
}));

vi.mock('@/lib/posthog/public-blog-pageview', () => ({
  capturePublicBlogPageview: mocks.capturePublicBlogPageview,
  resetPublicBlogPageviewDedupe: mocks.resetPublicBlogPageviewDedupe,
  resolvePublicBlogPageviewAttribution:
    mocks.resolvePublicBlogPageviewAttribution,
}));

describe('PostHogPageviewTracker', () => {
  beforeEach(() => {
    pathname = '/';
    searchParams = new URLSearchParams();
    mocks.capturePostHogPageview.mockClear();
    mocks.capturePublicBlogPageview.mockClear();
    mocks.hasPostHogBrowserInitialized.mockReset();
    mocks.hasPostHogBrowserInitialized.mockReturnValue(false);
    mocks.initializePostHogBrowser.mockClear();
    mocks.resetPublicBlogPageviewDedupe.mockClear();
    mocks.resolvePublicBlogPageviewAttribution.mockClear();
    mocks.resolvePublicBlogPageviewAttribution.mockReturnValue({
      $referrer: '$direct',
      $referring_domain: '$direct',
    });
    window.history.replaceState(null, '', '/');
  });

  it('never boots PostHog or captures on a non-blog route before the client is initialized', async () => {
    render(<PostHogPageviewTracker />);

    // Give the effect's async body a chance to run so a regression that boots
    // pre-init would be caught.
    await Promise.resolve();
    await Promise.resolve();

    // The idle-gated instrumentation-client owns the boot + landing pageview, so
    // the tracker must not initialize the client or capture before it fires.
    expect(mocks.initializePostHogBrowser).not.toHaveBeenCalled();
    expect(mocks.capturePostHogPageview).not.toHaveBeenCalled();
    expect(mocks.capturePublicBlogPageview).not.toHaveBeenCalled();
    expect(mocks.resetPublicBlogPageviewDedupe).not.toHaveBeenCalled();
  });

  it('captures a pageview after mount once the client is initialized', async () => {
    mocks.hasPostHogBrowserInitialized.mockReturnValue(true);

    render(<PostHogPageviewTracker />);

    await waitFor(() => {
      expect(mocks.capturePostHogPageview).toHaveBeenCalledWith(
        'http://localhost:3000/'
      );
    });
    expect(mocks.resetPublicBlogPageviewDedupe).toHaveBeenCalledOnce();
    // Reconfigures the already-booted client for the (non-lightweight) surface;
    // it never re-runs posthog.init().
    expect(mocks.initializePostHogBrowser).toHaveBeenCalledWith(
      expect.objectContaining({
        NODE_ENV: expect.any(String),
      }),
      console,
      {
        lightweight: false,
        pathname: '/',
        hostname: 'localhost',
      }
    );
  });

  it('captures a pageview when the pathname changes on an initialized client', async () => {
    mocks.hasPostHogBrowserInitialized.mockReturnValue(true);
    const { rerender } = render(<PostHogPageviewTracker />);

    await waitFor(() => {
      expect(mocks.capturePostHogPageview).toHaveBeenCalledTimes(1);
    });

    pathname = '/pricing';
    window.history.pushState(null, '', '/pricing?plan=starter');
    rerender(<PostHogPageviewTracker />);

    await waitFor(() => {
      expect(mocks.capturePostHogPageview).toHaveBeenCalledWith(
        'http://localhost:3000/pricing?plan=starter'
      );
    });
  });

  it('captures public blog pageviews with the lightweight beacon only before the full client initializes', async () => {
    pathname = '/ogabassey/blog/phone-guide';
    window.history.replaceState(null, '', pathname);

    render(<PostHogPageviewTracker />);

    await waitFor(() => {
      expect(mocks.capturePublicBlogPageview).toHaveBeenCalledWith(
        expect.objectContaining({
          NODE_ENV: expect.any(String),
        }),
        'http://localhost:3000/ogabassey/blog/phone-guide'
      );
    });
    expect(mocks.initializePostHogBrowser).not.toHaveBeenCalled();
    expect(mocks.capturePostHogPageview).not.toHaveBeenCalled();
  });

  it('reconfigures an initialized PostHog client to lightweight mode on public blog pages', async () => {
    mocks.hasPostHogBrowserInitialized.mockReturnValue(true);
    pathname = '/ogabassey/blog/phone-guide';
    window.history.replaceState(null, '', pathname);

    render(<PostHogPageviewTracker />);

    await waitFor(() => {
      expect(mocks.initializePostHogBrowser).toHaveBeenCalledWith(
        expect.objectContaining({
          NODE_ENV: expect.any(String),
        }),
        console,
        {
          lightweight: true,
          pathname: '/ogabassey/blog/phone-guide',
          hostname: 'localhost',
        }
      );
    });
    expect(mocks.capturePostHogPageview).toHaveBeenCalledWith(
      'http://localhost:3000/ogabassey/blog/phone-guide',
      {
        $referrer: '$direct',
        $referring_domain: '$direct',
      }
    );
    expect(mocks.capturePublicBlogPageview).not.toHaveBeenCalled();
  });

  it('gates initialized blog pageviews on analytics consent and captures after consent is granted', async () => {
    mocks.hasPostHogBrowserInitialized.mockReturnValue(true);
    mocks.resolvePublicBlogPageviewAttribution.mockReturnValue(null);
    pathname = '/ogabassey/blog/phone-guide';
    window.history.replaceState(null, '', pathname);

    render(<PostHogPageviewTracker />);

    await waitFor(() => {
      expect(mocks.initializePostHogBrowser).toHaveBeenCalledWith(
        expect.objectContaining({
          NODE_ENV: expect.any(String),
        }),
        console,
        {
          lightweight: true,
          pathname: '/ogabassey/blog/phone-guide',
          hostname: 'localhost',
        }
      );
    });
    expect(mocks.capturePostHogPageview).not.toHaveBeenCalled();

    mocks.resolvePublicBlogPageviewAttribution.mockReturnValue({
      $referrer: '$direct',
      $referring_domain: '$direct',
    });
    window.dispatchEvent(new Event('cookie-consent-updated'));

    await waitFor(() => {
      expect(mocks.capturePostHogPageview).toHaveBeenCalledWith(
        'http://localhost:3000/ogabassey/blog/phone-guide',
        {
          $referrer: '$direct',
          $referring_domain: '$direct',
        }
      );
    });
  });

  it('preserves attribution on the initialized blog path', async () => {
    mocks.hasPostHogBrowserInitialized.mockReturnValue(true);
    const attribution = {
      $referrer: 'https://google.com',
      $referring_domain: 'google.com',
      utm_source: 'newsletter',
    };
    mocks.resolvePublicBlogPageviewAttribution.mockReturnValue(attribution);
    pathname = '/ogabassey/blog/phone-guide';
    searchParams = new URLSearchParams('utm_source=newsletter');
    window.history.replaceState(null, '', `${pathname}?${searchParams}`);

    render(<PostHogPageviewTracker />);

    await waitFor(() => {
      expect(mocks.capturePostHogPageview).toHaveBeenCalledWith(
        'http://localhost:3000/ogabassey/blog/phone-guide?utm_source=newsletter',
        attribution
      );
    });
    expect(mocks.initializePostHogBrowser).toHaveBeenCalledWith(
      expect.objectContaining({
        NODE_ENV: expect.any(String),
      }),
      console,
      {
        lightweight: true,
        pathname: '/ogabassey/blog/phone-guide',
        hostname: 'localhost',
      }
    );
  });

  it('clears public blog dedupe before reconfiguring the initialized client on non-blog pages', async () => {
    mocks.hasPostHogBrowserInitialized.mockReturnValue(true);
    render(<PostHogPageviewTracker />);

    await waitFor(() => {
      expect(mocks.capturePostHogPageview).toHaveBeenCalledWith(
        'http://localhost:3000/'
      );
    });

    const [resetOrder] =
      mocks.resetPublicBlogPageviewDedupe.mock.invocationCallOrder;
    const [initializeOrder] =
      mocks.initializePostHogBrowser.mock.invocationCallOrder;
    const [captureOrder] =
      mocks.capturePostHogPageview.mock.invocationCallOrder;

    expect(resetOrder).toBeLessThan(initializeOrder);
    expect(resetOrder).toBeLessThan(captureOrder);
  });

  it('captures after a client navigation from a blog page to a non-blog page once the client has booted', async () => {
    pathname = '/ogabassey/blog/phone-guide';
    window.history.replaceState(null, '', pathname);
    const { rerender } = render(<PostHogPageviewTracker />);

    await waitFor(() => {
      expect(mocks.capturePublicBlogPageview).toHaveBeenCalledWith(
        expect.objectContaining({
          NODE_ENV: expect.any(String),
        }),
        'http://localhost:3000/ogabassey/blog/phone-guide'
      );
    });
    expect(mocks.initializePostHogBrowser).not.toHaveBeenCalled();

    // Simulate the idle boot firing between navigations so the full client is
    // now live.
    mocks.hasPostHogBrowserInitialized.mockReturnValue(true);
    pathname = '/ogabassey/laptops/macbook-pro';
    window.history.pushState(null, '', pathname);
    rerender(<PostHogPageviewTracker />);

    await waitFor(() => {
      expect(mocks.capturePostHogPageview).toHaveBeenCalledWith(
        'http://localhost:3000/ogabassey/laptops/macbook-pro'
      );
      expect(mocks.initializePostHogBrowser).toHaveBeenCalledOnce();
    });
    expect(mocks.resetPublicBlogPageviewDedupe).toHaveBeenCalledOnce();
    expect(mocks.initializePostHogBrowser).toHaveBeenLastCalledWith(
      expect.objectContaining({
        NODE_ENV: expect.any(String),
      }),
      console,
      {
        lightweight: false,
        pathname: '/ogabassey/laptops/macbook-pro',
        hostname: 'localhost',
      }
    );
  });

  it('captures a pageview when only public blog search params change', async () => {
    pathname = '/ogabassey/blog';
    searchParams = new URLSearchParams('page=1');
    window.history.replaceState(null, '', `${pathname}?${searchParams}`);
    const { rerender } = render(<PostHogPageviewTracker />);

    await waitFor(() => {
      expect(mocks.capturePublicBlogPageview).toHaveBeenCalledWith(
        expect.objectContaining({
          NODE_ENV: expect.any(String),
        }),
        'http://localhost:3000/ogabassey/blog?page=1'
      );
    });

    searchParams = new URLSearchParams('page=2');
    window.history.pushState(null, '', `${pathname}?${searchParams}`);
    rerender(<PostHogPageviewTracker />);

    await waitFor(() => {
      expect(mocks.capturePublicBlogPageview).toHaveBeenCalledWith(
        expect.objectContaining({
          NODE_ENV: expect.any(String),
        }),
        'http://localhost:3000/ogabassey/blog?page=2'
      );
    });
    expect(mocks.capturePublicBlogPageview).toHaveBeenCalledTimes(2);
    expect(mocks.initializePostHogBrowser).not.toHaveBeenCalled();
    expect(mocks.capturePostHogPageview).not.toHaveBeenCalled();
  });
});
