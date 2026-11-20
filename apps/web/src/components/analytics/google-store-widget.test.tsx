import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MerchantData } from '@/hooks/merchant/types';
import {
  GoogleStoreWidget,
  MERCHANT_WIDGET_IFRAME_TITLE,
  resolveGoogleStoreWidgetPreference,
} from './google-store-widget';

vi.mock('next/script', () => ({
  default: ({
    id,
    src,
    onLoad,
  }: {
    id?: string;
    src?: string;
    onLoad?: () => void;
  }) => {
    useEffect(() => {
      onLoad?.();
    }, [onLoad]);

    return <script data-testid={id} src={src} />;
  },
}));

const baseMerchant: MerchantData = {
  id: 'merchant-1',
  user_id: 'user-1',
  business_name: 'Ogabassey',
  business_type: 'electronics',
  slug: 'ogabassey',
  custom_domain: 'ogabassey.com',
};

const originalMerchantWidget = window.merchantwidget;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  consoleWarnSpy = vi
    .spyOn(console, 'warn')
    .mockImplementation(() => undefined);
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  consoleWarnSpy.mockRestore();
  document.querySelectorAll('iframe').forEach((frame) => {
    frame.remove();
  });

  if (originalMerchantWidget) {
    window.merchantwidget = originalMerchantWidget;
    return;
  }

  delete window.merchantwidget;
});

describe('GoogleStoreWidget', () => {
  it('waits to load the widget script until after the defer window elapses', () => {
    const start = vi.fn();
    window.merchantwidget = { start };

    render(
      <GoogleStoreWidget merchant={baseMerchant} hostname="www.ogabassey.com" />
    );

    expect(
      screen.queryByTestId('google-store-widget-script')
    ).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(19999);
    });

    expect(
      screen.queryByTestId('google-store-widget-script')
    ).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(
      screen.getByTestId('google-store-widget-script')
    ).toBeInTheDocument();

    expect(start).toHaveBeenCalledWith({
      position: 'LEFT_BOTTOM',
      sideMargin: 24,
      bottomMargin: 24,
      mobileSideMargin: 16,
      mobileBottomMargin: 104,
    });
  });

  it('ships an out-of-flow rule that pins the injected widget wrapper from first paint', () => {
    const start = vi.fn();
    window.merchantwidget = { start };

    render(
      <GoogleStoreWidget merchant={baseMerchant} hostname="www.ogabassey.com" />
    );

    act(() => {
      vi.advanceTimersByTime(20000);
    });

    // The gstatic script injects `#google-merchantwidget-iframe-wrapper` in
    // normal flow before pinning it; the shipped rule makes it fixed on
    // insertion so it never occupies flow (no recorded layout shift).
    const wrapperRule = Array.from(document.querySelectorAll('style')).find(
      (style) =>
        style.textContent?.includes('#google-merchantwidget-iframe-wrapper')
    );

    expect(wrapperRule).toBeDefined();
    expect(wrapperRule?.textContent).toContain('position:fixed!important');
    // Desktop corner offsets mirror the LEFT_BOTTOM start() margins.
    expect(wrapperRule?.textContent).toContain('@media (min-width:768px)');
  });

  it('keeps the injected badge frame on the light scheme inside a dark store', () => {
    window.merchantwidget = { start: vi.fn() };
    // Dark storefront: the frame would otherwise inherit this scheme, and a
    // browser paints an opaque white canvas behind a frame whose scheme
    // differs from its (light-only) document.
    document.documentElement.style.setProperty('color-scheme', 'dark');
    // What Google's script injects: its wrapper with the badge frame inside.
    const wrapper = document.createElement('div');
    wrapper.id = 'google-merchantwidget-iframe-wrapper';
    const frame = document.createElement('iframe');
    frame.id = 'merchantwidgetiframe';
    wrapper.append(frame);
    const unrelatedFrame = document.createElement('iframe');
    document.body.append(wrapper, unrelatedFrame);

    try {
      const { container } = render(
        <GoogleStoreWidget
          merchant={baseMerchant}
          hostname="www.ogabassey.com"
        />
      );

      act(() => {
        vi.advanceTimersByTime(20000);
      });

      // The rule ships in this render's own style element.
      const shippedRule = Array.from(container.querySelectorAll('style')).find(
        (style) =>
          style.textContent?.includes('#google-merchantwidget-iframe-wrapper')
      );
      expect(shippedRule).toBeDefined();

      expect(getComputedStyle(frame).getPropertyValue('color-scheme')).toBe(
        'light'
      );
      // Only the badge frame is pinned; other frames keep the store scheme.
      expect(
        getComputedStyle(unrelatedFrame).getPropertyValue('color-scheme')
      ).not.toBe('light');
    } finally {
      wrapper.remove();
      unrelatedFrame.remove();
      document.documentElement.style.removeProperty('color-scheme');
    }
  });

  it('renders when the merchant has no custom domain configured', () => {
    const start = vi.fn();
    window.merchantwidget = { start };
    const merchantWithoutDomain = {
      ...baseMerchant,
      custom_domain: undefined,
    };

    render(
      <GoogleStoreWidget
        merchant={merchantWithoutDomain}
        hostname="preview.usebaci.com"
      />
    );

    act(() => {
      vi.advanceTimersByTime(20000);
    });

    expect(
      screen.getByTestId('google-store-widget-script')
    ).toBeInTheDocument();

    expect(start).toHaveBeenCalledWith({
      position: 'LEFT_BOTTOM',
      sideMargin: 24,
      bottomMargin: 24,
      mobileSideMargin: 16,
      mobileBottomMargin: 104,
    });
  });

  it('passes the Merchant Center ID to the store widget when configured', () => {
    const start = vi.fn();
    window.merchantwidget = { start };

    render(
      <GoogleStoreWidget
        merchant={{
          ...baseMerchant,
          feature_settings: {
            custom_settings: { google_merchant_id: '112524323' },
          },
        }}
        hostname="ogabassey.com"
      />
    );

    act(() => {
      vi.advanceTimersByTime(20000);
    });

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ merchant_id: 112_524_323 })
    );
  });

  it('does not render when the current hostname does not match the merchant domain', () => {
    render(
      <GoogleStoreWidget
        merchant={baseMerchant}
        hostname="preview.usebaci.com"
      />
    );

    expect(
      screen.queryByTestId('google-store-widget-script')
    ).not.toBeInTheDocument();
  });

  it('does not render when explicitly disabled', () => {
    render(
      <GoogleStoreWidget
        merchant={baseMerchant}
        enabled={false}
        hostname="ogabassey.com"
      />
    );

    expect(
      screen.queryByTestId('google-store-widget-script')
    ).not.toBeInTheDocument();
  });

  it('loads immediately after a user interaction on a matching domain', async () => {
    const start = vi.fn();
    window.merchantwidget = { start };

    render(
      <GoogleStoreWidget merchant={baseMerchant} hostname="ogabassey.com" />
    );

    expect(
      screen.queryByTestId('google-store-widget-script')
    ).not.toBeInTheDocument();

    fireEvent.pointerDown(window);

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      screen.getByTestId('google-store-widget-script')
    ).toBeInTheDocument();
    expect(start).toHaveBeenCalledOnce();
  });

  it('does not load the widget script on scroll before the defer window elapses', async () => {
    const start = vi.fn();
    window.merchantwidget = { start };
    let unmount: (() => void) | undefined;

    await act(async () => {
      ({ unmount } = render(
        <GoogleStoreWidget merchant={baseMerchant} hostname="ogabassey.com" />
      ));
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.scroll(window);
      await Promise.resolve();
    });

    expect(
      screen.queryByTestId('google-store-widget-script')
    ).not.toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();

    // Manual teardown keeps the deferred widget timer from firing during
    // afterEach cleanup; this test intentionally verifies scroll does not load.
    act(() => {
      unmount?.();
    });
  });

  it('supports passing only the merchant custom domain', () => {
    const start = vi.fn();
    window.merchantwidget = { start };

    render(
      <GoogleStoreWidget
        merchantCustomDomain="ogabassey.com"
        hostname="ogabassey.com"
      />
    );

    act(() => {
      vi.advanceTimersByTime(20000);
    });

    expect(
      screen.getByTestId('google-store-widget-script')
    ).toBeInTheDocument();
    expect(start).toHaveBeenCalledOnce();
  });

  it('can skip the internal defer window when an outer shell already delayed mounting', async () => {
    const start = vi.fn();
    window.merchantwidget = { start };

    render(
      <GoogleStoreWidget
        merchantCustomDomain="ogabassey.com"
        hostname="ogabassey.com"
        skipActivationDelay
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      screen.getByTestId('google-store-widget-script')
    ).toBeInTheDocument();
    expect(start).toHaveBeenCalledOnce();
  });

  it('adds an accessible title to the iframe inserted by the merchant widget', () => {
    window.merchantwidget = {
      start: () => {
        const iframe = document.createElement('iframe');
        iframe.id = 'merchantwidgetiframe';
        document.body.appendChild(iframe);
      },
    };

    render(
      <GoogleStoreWidget merchant={baseMerchant} hostname="ogabassey.com" />
    );

    act(() => {
      vi.advanceTimersByTime(20000);
    });

    expect(document.getElementById('merchantwidgetiframe')).toHaveAttribute(
      'title',
      MERCHANT_WIDGET_IFRAME_TITLE
    );
  });

  it('falls back to a Google iframe src when the widget iframe id changes', async () => {
    window.merchantwidget = {
      start: () => {
        const unrelatedIframe = document.createElement('iframe');
        unrelatedIframe.id = 'google-maps-frame';
        unrelatedIframe.src = 'https://www.google.com/maps/embed';
        document.body.appendChild(unrelatedIframe);

        const iframe = document.createElement('iframe');
        iframe.src = 'https://www.google.com/shopping/merchantverse/';
        document.body.appendChild(iframe);
      },
    };

    render(
      <GoogleStoreWidget merchant={baseMerchant} hostname="ogabassey.com" />
    );

    await act(async () => {
      vi.advanceTimersByTime(20000);
      await Promise.resolve();
    });

    expect(
      document.querySelector('iframe[src*="google.com/shopping/merchantverse"]')
    ).toHaveAttribute('title', MERCHANT_WIDGET_IFRAME_TITLE);
    expect(document.getElementById('google-maps-frame')).not.toHaveAttribute(
      'title',
      MERCHANT_WIDGET_IFRAME_TITLE
    );
  });

  it('keeps observing until a deferred merchant iframe is inserted', async () => {
    window.merchantwidget = {
      start: vi.fn(),
    };

    render(
      <GoogleStoreWidget merchant={baseMerchant} hostname="ogabassey.com" />
    );

    await act(async () => {
      vi.advanceTimersByTime(20000);
      await Promise.resolve();
    });

    const iframe = document.createElement('iframe');
    iframe.src = 'https://www.google.com/shopping/merchantverse/';

    await act(async () => {
      vi.advanceTimersByTime(25000);
      document.body.appendChild(iframe);
      await Promise.resolve();
    });

    expect(iframe).toHaveAttribute('title', MERCHANT_WIDGET_IFRAME_TITLE);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('does not throw when merchantwidget API is unavailable after script load', () => {
    delete window.merchantwidget;

    expect(() =>
      render(
        <GoogleStoreWidget merchant={baseMerchant} hostname="ogabassey.com" />
      )
    ).not.toThrow();

    act(() => {
      vi.advanceTimersByTime(20000);
    });

    expect(
      screen.getByTestId('google-store-widget-script')
    ).toBeInTheDocument();
  });
});

describe('resolveGoogleStoreWidgetPreference', () => {
  it('prefers the direct feature setting when present', () => {
    expect(
      resolveGoogleStoreWidgetPreference({
        ...baseMerchant,
        feature_settings: {
          google_store_widget_enabled: false,
          custom_settings: { google_store_widget_enabled: true },
        },
      })
    ).toBe(false);
  });

  it('falls back to custom settings when the direct feature setting is absent', () => {
    expect(
      resolveGoogleStoreWidgetPreference({
        ...baseMerchant,
        feature_settings: {
          custom_settings: { google_store_widget_enabled: true },
        },
      })
    ).toBe(true);
  });

  it('returns undefined when no explicit preference is configured', () => {
    expect(resolveGoogleStoreWidgetPreference(baseMerchant)).toBeUndefined();
  });
});
