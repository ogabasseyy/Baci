import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildPostHogClientConfig,
  resolvePostHogWebTenantContext,
  sanitizePostHogCapture,
  sanitizePostHogProperties,
} from './client-config';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PostHog client config', () => {
  it('keeps PostHog web-vitals off while preserving exception capture and privacy-safe replay defaults', () => {
    const config = buildPostHogClientConfig({
      NEXT_PUBLIC_POSTHOG_PROXY_PATH: '/baci-observe',
      NEXT_PUBLIC_POSTHOG_UI_HOST: 'https://eu.posthog.com',
      NODE_ENV: 'production',
    });

    expect(config).toMatchObject({
      api_host: '/baci-observe',
      ui_host: 'https://eu.posthog.com',
      defaults: '2026-05-30',
      autocapture: true,
      person_profiles: 'identified_only',
      capture_pageview: false,
      capture_pageleave: false,
      // WEIGHT-B P1: dead-clicks + heatmaps are OFF on the storefront (LoAF
      // click-processing cost + dead-clicks bundle duplication).
      capture_dead_clicks: false,
      capture_heatmaps: false,
      capture_exceptions: {
        capture_unhandled_errors: true,
        capture_unhandled_rejections: true,
        capture_console_errors: false,
      },
      capture_performance: false,
      rate_limiting: {
        events_per_second: 8,
        events_burst_limit: 64,
      },
      tracing_headers: ['usebaci.com', 'www.usebaci.com'],
      mask_all_text: true,
      mask_all_element_attributes: true,
      session_recording: expect.objectContaining({
        maskAllInputs: true,
        maskTextFn: expect.any(Function),
        maskTextSelector: 'body',
        sampleRate: 0.05,
      }),
    });
    expect(config.property_blacklist).not.toContain('token');
    expect(config.session_recording?.maskTextFn?.('private note')).toBe(
      '[Filtered]'
    );
  });

  it('samples session recording at the trimmed 5% rate on full surfaces', () => {
    const config = buildPostHogClientConfig({ NODE_ENV: 'production' });

    expect(config.disable_session_recording).toBe(false);
    expect(config.session_recording?.sampleRate).toBe(0.05);
    // Privacy masking must survive the sampling trim.
    expect(config.session_recording?.maskAllInputs).toBe(true);
  });

  it('keeps autocapture and rageclick while dropping heatmaps/dead-clicks', () => {
    const config = buildPostHogClientConfig({ NODE_ENV: 'production' });

    expect(config.autocapture).toBe(true);
    expect(config.rageclick).toBe(true);
    expect(config.disable_session_recording).toBe(false);
    expect(config.disable_surveys).toBe(true);
    expect(config.capture_heatmaps).toBe(false);
    expect(config.capture_dead_clicks).toBe(false);
    expect(config.advanced_disable_flags).toBe(false);
  });

  it('returns a lightweight config for public blog surfaces', () => {
    const config = buildPostHogClientConfig(
      { NODE_ENV: 'production' },
      'phc_public_token',
      { lightweight: true }
    );

    expect(config).toMatchObject({
      advanced_disable_flags: true,
      autocapture: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      capture_performance: false,
      disable_session_recording: true,
      rageclick: false,
    });
    expect(config.capture_pageview).toBe(false);
    expect(config.before_send).toEqual(expect.any(Function));
    expect(config.loaded).toEqual(expect.any(Function));
    expect(config.property_blacklist).toContain('email');
  });

  it('registers stable app and tenant context after PostHog loads', () => {
    const config = buildPostHogClientConfig({
      NODE_ENV: 'production',
      NEXT_PUBLIC_ROOT_DOMAIN: 'usebaci.com',
      NEXT_PUBLIC_POSTHOG_RELEASE_VERSION: 'web-release',
      NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: 'main',
      NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: 'public-sha',
      NEXT_PUBLIC_VERCEL_URL: 'baci-git-main.vercel.app',
    });
    const register = vi.fn();
    vi.stubGlobal('location', {
      hostname: 'ogabassey.usebaci.com',
      pathname: '/products/iphone',
    });

    config.loaded?.({
      register,
    } as never);

    expect(register).toHaveBeenCalledWith({
      app_surface: 'web',
      deployment_environment: 'production',
      release_version: 'web-release',
      git_commit_ref: 'main',
      git_commit_sha: 'public-sha',
      merchant_domain: 'ogabassey.usebaci.com',
      merchant_slug: 'ogabassey',
      vercel_environment: 'production',
      vercel_url: 'baci-git-main.vercel.app',
    });
    vi.unstubAllGlobals();
  });

  it('derives merchant context from storefront URL shapes', () => {
    expect(
      resolvePostHogWebTenantContext(
        { NEXT_PUBLIC_ROOT_DOMAIN: 'usebaci.com' },
        { hostname: 'usebaci.com', pathname: '/ogabassey/products/iphone' }
      )
    ).toEqual({ merchant_slug: 'ogabassey' });

    expect(
      resolvePostHogWebTenantContext(
        { NEXT_PUBLIC_ROOT_DOMAIN: 'usebaci.com' },
        { hostname: 'ogabassey.com', pathname: '/products/iphone' }
      )
    ).toEqual({ merchant_domain: 'ogabassey.com' });

    expect(
      resolvePostHogWebTenantContext(
        { NEXT_PUBLIC_ROOT_DOMAIN: 'usebaci.com' },
        { hostname: 'usebaci.com', pathname: '/dashboard' }
      )
    ).toEqual({});
  });

  it('does not stamp platform routes or reserved subdomains as merchants', () => {
    for (const pathname of [
      '/about',
      '/contact',
      '/features',
      '/invite/invite_token_123',
      '/privacy',
      '/staff/accept',
      '/terms',
    ]) {
      expect(
        resolvePostHogWebTenantContext(
          { NEXT_PUBLIC_ROOT_DOMAIN: 'usebaci.com' },
          { hostname: 'usebaci.com', pathname }
        )
      ).toEqual({});
    }

    for (const hostname of [
      'app.usebaci.com',
      'dashboard.usebaci.com',
      'api.usebaci.com',
    ]) {
      expect(
        resolvePostHogWebTenantContext(
          { NEXT_PUBLIC_ROOT_DOMAIN: 'usebaci.com' },
          { hostname, pathname: '/checkout' }
        )
      ).toEqual({});
    }
  });

  it('redacts sensitive property names, emails, and URL query strings', () => {
    expect(
      sanitizePostHogProperties({
        email: 'buyer@example.com',
        note: 'Contact buyer@example.com and support@example.com before delivery',
        $current_url: 'https://ogabassey.com/cart?token=secret#checkout',
        $el_text: 'Jane Buyer, 12 Checkout Street',
        $elements_chain: 'button:contains("Jane Buyer paid order")',
        $elements: [
          {
            tag_name: 'button',
            text: 'Jane Buyer paid order',
            'attr__aria-label': 'Pay Jane Buyer',
            href: '/checkout?email=buyer@example.com',
          },
        ],
        request_path: '/checkout/success?email=buyer@example.com',
        $session_id: '018f-session',
        shipping: 2500,
        shipping_fee: 2500,
        shippingPin: '1234',
        card_number: 'test_card_number',
        nested: {
          phone: '+2348000000000',
          path: '/checkout',
        },
      })
    ).toEqual({
      email: '[Filtered]',
      note: 'Contact [Filtered] and [Filtered] before delivery',
      $current_url: 'https://ogabassey.com/cart',
      $el_text: '[Filtered]',
      $elements_chain: '[Filtered]',
      $elements: [
        {
          tag_name: 'button',
          text: '[Filtered]',
          'attr__aria-label': '[Filtered]',
          href: '/checkout',
        },
      ],
      request_path: '/checkout/success',
      $session_id: '018f-session',
      shipping: 2500,
      shipping_fee: 2500,
      shippingPin: '[Filtered]',
      card_number: '[Filtered]',
      nested: {
        phone: '[Filtered]',
        path: '/checkout',
      },
    });
  });

  it('sanitizes capture payloads before sending', () => {
    expect(
      sanitizePostHogCapture({
        uuid: 'event-1',
        event: '$pageview',
        properties: {
          $current_url: 'https://ogabassey.com/?email=buyer@example.com',
        },
        $set: {
          phone: '+2348000000000',
        },
        $set_once: {
          first_seen_url: 'https://ogabassey.com/?utm_source=test',
        },
      })
    ).toMatchObject({
      properties: {
        $current_url: 'https://ogabassey.com/',
      },
      $set: {
        phone: '[Filtered]',
      },
      $set_once: {
        first_seen_url: 'https://ogabassey.com/',
      },
    });
  });

  it('preserves PostHog project credentials required for ingestion', () => {
    const capture = sanitizePostHogCapture(
      {
        uuid: 'event-1',
        event: '$pageview',
        properties: {
          token: 'raw-user-token',
          nested: {
            token: 'raw-nested-token',
          },
        },
      },
      'phc_public_project_token'
    );

    expect(capture?.properties).toMatchObject({
      token: 'phc_public_project_token',
      api_key: 'phc_public_project_token',
      nested: {
        token: '[Filtered]',
      },
    });
  });

  it('stamps capture payloads with tenant context from the current browser route', () => {
    vi.stubGlobal('location', {
      hostname: 'usebaci.com',
      pathname: '/ogabassey/products/iphone',
      origin: 'https://usebaci.com',
    });

    const capture = sanitizePostHogCapture({
      uuid: 'event-1',
      event: '$web_vitals',
      properties: {
        merchant_domain: 'old-merchant.example',
        merchant_slug: 'old-merchant',
      },
    });

    expect(capture?.properties).toMatchObject({
      merchant_slug: 'ogabassey',
    });
    expect(capture?.properties).not.toHaveProperty('merchant_domain');
    vi.unstubAllGlobals();
  });

  it('keeps deferred exception tenant context tied to its stamped origin URL through before_send', () => {
    const config = buildPostHogClientConfig(
      {
        NEXT_PUBLIC_ROOT_DOMAIN: 'usebaci.com',
        NODE_ENV: 'production',
      },
      'phc_public_project_token'
    );
    vi.stubGlobal('location', {
      hostname: 'usebaci.com',
      pathname: '/merchant-b/products',
      origin: 'https://usebaci.com',
    });
    const beforeSend = config.before_send;

    expect(typeof beforeSend).toBe('function');
    if (typeof beforeSend !== 'function') {
      throw new Error('Expected a PostHog before_send function.');
    }

    const capture = beforeSend({
      uuid: 'event-1',
      event: '$exception',
      properties: {
        $current_url:
          'https://usebaci.com/merchant-a/checkout?token=raw_secret',
        $pathname: '/merchant-a/checkout',
        merchant_slug: 'merchant-b',
      },
    });

    expect(capture?.properties).toMatchObject({
      $current_url: 'https://usebaci.com/merchant-a/checkout',
      merchant_slug: 'merchant-a',
    });
    expect(capture?.properties?.merchant_slug).not.toBe('merchant-b');
    vi.unstubAllGlobals();
  });

  it('falls back to the current location when an exception origin URL is absent or invalid', () => {
    const config = buildPostHogClientConfig({
      NEXT_PUBLIC_ROOT_DOMAIN: 'usebaci.com',
      NODE_ENV: 'production',
    });
    vi.stubGlobal('location', {
      hostname: 'usebaci.com',
      pathname: '/merchant-b/products',
      origin: 'https://usebaci.com',
    });
    const beforeSend = config.before_send;

    if (typeof beforeSend !== 'function') {
      throw new Error('Expected a PostHog before_send function.');
    }

    for (const currentUrl of [undefined, '   ', 'http://[invalid']) {
      const capture = beforeSend({
        uuid: `event-${String(currentUrl)}`,
        event: '$exception',
        properties: {
          ...(currentUrl === undefined ? {} : { $current_url: currentUrl }),
        },
      });

      expect(capture?.properties?.merchant_slug).toBe('merchant-b');
    }

    const pageview = beforeSend({
      uuid: 'event-pageview',
      event: '$pageview',
      properties: {
        $current_url: 'https://usebaci.com/merchant-a/products',
      },
    });
    expect(pageview?.properties?.merchant_slug).toBe('merchant-b');
    vi.unstubAllGlobals();
  });

  it('drops web-vitals captures while the current route is a public blog page', () => {
    vi.stubGlobal('location', {
      hostname: 'usebaci.com',
      pathname: '/ogabassey/blog/best-phones',
      origin: 'https://usebaci.com',
    });

    expect(
      sanitizePostHogCapture({
        uuid: 'event-1',
        event: '$web_vitals',
        properties: {
          $web_vitals_LCP_event: {
            $current_url: 'https://usebaci.com/ogabassey/blog/best-phones',
            name: 'LCP',
            value: 1200,
          },
        },
      })
    ).toBeNull();

    expect(
      sanitizePostHogCapture({
        uuid: 'event-2',
        event: '$pageview',
        properties: {
          $current_url: 'https://usebaci.com/ogabassey/blog/best-phones',
        },
      })
    ).toMatchObject({
      event: '$pageview',
      properties: {
        $current_url: 'https://usebaci.com/ogabassey/blog/best-phones',
      },
    });

    vi.unstubAllGlobals();
  });

  it('drops delayed web-vitals captures whose metric URL came from a public blog page', () => {
    vi.stubGlobal('location', {
      hostname: 'usebaci.com',
      pathname: '/ogabassey/products',
      origin: 'https://usebaci.com',
    });

    expect(
      sanitizePostHogCapture({
        uuid: 'event-1',
        event: '$web_vitals',
        properties: {
          $web_vitals_CLS_event: {
            $current_url: 'https://ogabassey.com/blog/best-phones',
            name: 'CLS',
            value: 0.01,
          },
        },
      })
    ).toBeNull();

    vi.unstubAllGlobals();
  });

  it('keeps delayed non-blog web-vitals captures after navigating to a blog page', () => {
    vi.stubGlobal('location', {
      hostname: 'usebaci.com',
      pathname: '/ogabassey/blog/best-phones',
      origin: 'https://usebaci.com',
    });

    expect(
      sanitizePostHogCapture({
        uuid: 'event-1',
        event: '$web_vitals',
        properties: {
          $web_vitals_LCP_event: {
            $current_url: 'https://usebaci.com/ogabassey/products/iphone',
            name: 'LCP',
            value: 1200,
          },
        },
      })
    ).toMatchObject({
      event: '$web_vitals',
      properties: {
        $web_vitals_LCP_event: {
          $current_url: 'https://usebaci.com/ogabassey/products/iphone',
        },
      },
    });

    vi.unstubAllGlobals();
  });

  it('drops the custom flat web_vitals event on a public blog route (not just $web_vitals)', () => {
    vi.stubGlobal('location', {
      hostname: 'usebaci.com',
      pathname: '/ogabassey/blog/best-phones',
      origin: 'https://usebaci.com',
    });

    // capturePostHogWebVitals emits event: 'web_vitals' (no leading $). It must be
    // dropped on blog surfaces exactly like PostHog's autocapture '$web_vitals'.
    expect(
      sanitizePostHogCapture({
        uuid: 'event-1',
        event: 'web_vitals',
        properties: {
          metric: 'LCP',
          value: 1200,
          rating: 'good',
          navigationType: 'navigate',
          pathname: '/ogabassey/blog/best-phones',
        },
      })
    ).toBeNull();

    vi.unstubAllGlobals();
  });

  it('keeps the custom flat web_vitals event on a non-blog route', () => {
    vi.stubGlobal('location', {
      hostname: 'usebaci.com',
      pathname: '/ogabassey/products/iphone',
      origin: 'https://usebaci.com',
    });

    expect(
      sanitizePostHogCapture({
        uuid: 'event-1',
        event: 'web_vitals',
        properties: {
          metric: 'LCP',
          value: 1200,
          rating: 'good',
          navigationType: 'navigate',
          pathname: '/ogabassey/products/iphone',
        },
      })
    ).toMatchObject({
      event: 'web_vitals',
      properties: { metric: 'LCP' },
    });

    vi.unstubAllGlobals();
  });

  it('removes stale tenant context from capture payloads on platform routes', () => {
    vi.stubGlobal('location', {
      hostname: 'usebaci.com',
      pathname: '/staff/accept',
      origin: 'https://usebaci.com',
    });

    const capture = sanitizePostHogCapture({
      uuid: 'event-1',
      event: '$pageview',
      properties: {
        merchant_domain: 'ogabassey.com',
        merchant_slug: 'ogabassey',
      },
    });

    expect(capture?.properties).not.toHaveProperty('merchant_domain');
    expect(capture?.properties).not.toHaveProperty('merchant_slug');
    vi.unstubAllGlobals();
  });

  it('scrubs auto-captured exception payload values before sending', () => {
    expect(
      sanitizePostHogCapture({
        uuid: 'event-1',
        event: '$exception',
        properties: {
          $exception_list: [
            {
              type: 'Error',
              value:
                'checkout failed at https://ogabassey.com/order-success?trackingToken=track_secret&reference=ref_1234567 for buyer@example.com',
              stacktrace: {
                frames: [
                  {
                    filename:
                      'https://ogabassey.com/_next/static/chunk.js?token=raw_secret',
                    context_line: 'reference=ref_1234567',
                  },
                ],
              },
            },
          ],
        },
      })
    ).toMatchObject({
      properties: {
        $exception_list: [
          {
            value:
              'checkout failed at https://ogabassey.com/order-success for [Filtered]',
            stacktrace: {
              frames: [
                {
                  filename: 'https://ogabassey.com/_next/static/chunk.js',
                  context_line: 'reference=[Filtered]',
                },
              ],
            },
          },
        ],
      },
    });
  });

  it('drops synthetic browser Script error events with no actionable source', () => {
    expect(
      sanitizePostHogCapture({
        uuid: 'event-1',
        event: '$exception',
        properties: {
          $browser: 'Chrome',
          $browser_version: 143,
          $exception_values: ['Script error.'],
          $exception_list: [
            {
              type: 'Error',
              value: 'Script error.',
              mechanism: {
                handled: false,
                synthetic: true,
                type: 'generic',
              },
            },
          ],
        },
      })
    ).toBeNull();
  });

  it('keeps Script error without a synthetic flag actionable', () => {
    expect(
      sanitizePostHogCapture({
        uuid: 'event-1',
        event: '$exception',
        properties: {
          $browser: 'Chrome',
          $browser_version: 143,
          $exception_values: ['Script error.'],
          $exception_list: [
            {
              type: 'Error',
              value: 'Script error.',
              mechanism: {
                handled: false,
                synthetic: false,
                type: 'generic',
              },
            },
          ],
        },
      })
    ).toMatchObject({
      properties: {
        $browser: 'Chrome',
        $exception_values: ['Script error.'],
      },
    });
  });

  it('drops React hydration noise from browsers below the supported storefront floor', () => {
    expect(
      sanitizePostHogCapture({
        uuid: 'event-1',
        event: '$exception',
        properties: {
          $browser: 'Chrome',
          $browser_version: 51,
          $exception_values: [
            'Minified React error #419; visit https://react.dev/errors/419 for the full message.',
          ],
        },
      })
    ).toBeNull();
  });

  it('drops React hydration noise from Safari versions below the 15.4 storefront floor', () => {
    expect(
      sanitizePostHogCapture({
        uuid: 'event-1',
        event: '$exception',
        properties: {
          $browser: 'Safari',
          $browser_version: '15.3.1',
          $exception_values: [
            'Minified React error #418; visit https://react.dev/errors/418 for the full message.',
          ],
        },
      })
    ).toBeNull();
  });

  it('keeps React hydration errors from unknown browsers actionable', () => {
    expect(
      sanitizePostHogCapture({
        uuid: 'event-1',
        event: '$exception',
        properties: {
          $browser: 'Opera',
          $browser_version: 51,
          $exception_values: [
            'Minified React error #419; visit https://react.dev/errors/419 for the full message.',
          ],
        },
      })
    ).toMatchObject({
      properties: {
        $browser: 'Opera',
        $browser_version: 51,
      },
    });
  });

  it('keeps non-hydration exceptions from old browsers actionable', () => {
    expect(
      sanitizePostHogCapture({
        uuid: 'event-1',
        event: '$exception',
        properties: {
          $browser: 'Chrome',
          $browser_version: 51,
          $exception_values: ['TypeError: Cannot read properties of null'],
        },
      })
    ).toMatchObject({
      properties: {
        $browser: 'Chrome',
        $browser_version: 51,
      },
    });
  });

  it('keeps React hydration errors from supported browsers actionable', () => {
    expect(
      sanitizePostHogCapture({
        uuid: 'event-1',
        event: '$exception',
        properties: {
          $browser: 'Chrome',
          $browser_version: 138,
          $exception_values: [
            'Minified React error #418; visit https://react.dev/errors/418 for the full message.',
          ],
        },
      })
    ).toMatchObject({
      properties: {
        $browser: 'Chrome',
        $browser_version: 138,
      },
    });
  });

  it('keeps React hydration errors from Safari 15.4 actionable', () => {
    expect(
      sanitizePostHogCapture({
        uuid: 'event-1',
        event: '$exception',
        properties: {
          $browser: 'Safari',
          $browser_version: '15.4',
          $exception_values: [
            'Minified React error #418; visit https://react.dev/errors/418 for the full message.',
          ],
        },
      })
    ).toMatchObject({
      properties: {
        $browser: 'Safari',
        $browser_version: '15.4',
      },
    });
  });
});

describe('capture_performance invariant (plan: PR-MEASURE)', () => {
  it('NEVER enables PostHog web-vitals autocapture in any mode', () => {
    // Invariant, not preference: PostHog's built-in $web_vitals autocapture
    // (a) lacks TTFB entirely, (b) has no page-hide flush (our custom
    // web_vitals pipeline beacons on visibilitychange→hidden), and
    // (c) re-enabling it would run a duplicate, conflicting vitals pipeline
    // next to the custom flat `web_vitals` event. See
    // docs/perf/ogabassey-cwv-headroom-execution-plan.md → PR-MEASURE.
    const full = buildPostHogClientConfig();
    const lightweight = buildPostHogClientConfig(undefined, undefined, {
      lightweight: true,
    });

    expect(full.capture_performance).toBe(false);
    expect(lightweight.capture_performance).toBe(false);
  });
});
