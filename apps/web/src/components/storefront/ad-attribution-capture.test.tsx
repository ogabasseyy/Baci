// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLICK_ID_PARAMS } from '@/lib/ad-tracking-cookies';
import {
  AD_ATTRIBUTION_CAPTURE_SCRIPT,
  AdAttributionCapture,
} from './ad-attribution-capture';

describe('AdAttributionCapture (SSR markup)', () => {
  it('renders an inline script into the markup', () => {
    const markup = renderToStaticMarkup(<AdAttributionCapture />);

    expect(markup).toContain('<script>');
    expect(markup).toContain('/api/attr');
    expect(markup).toContain('method:"POST"');
  });

  it('emits the script verbatim (no HTML-escaping of the JS body)', () => {
    const markup = renderToStaticMarkup(<AdAttributionCapture />);

    expect(markup).toContain(AD_ATTRIBUTION_CAPTURE_SCRIPT);
    // Nothing that could break out of the <script> element.
    expect(AD_ATTRIBUTION_CAPTURE_SCRIPT).not.toContain('</script>');
  });

  it('references every known baci_* cookie name', () => {
    for (const cookieName of Object.values(CLICK_ID_PARAMS)) {
      expect(AD_ATTRIBUTION_CAPTURE_SCRIPT).toContain(cookieName);
    }
  });
});

/**
 * Exercises the inline script body itself by evaluating it in jsdom with a
 * controlled `document.prerendering`, `location.search`, `document.cookie`, and
 * a stubbed `fetch`.
 */
describe('AdAttributionCapture (runtime behaviour)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  function runScript() {
    // Evaluate the component's own trusted inline script string in the jsdom
    // sandbox to exercise its runtime behaviour.
    new Function(AD_ATTRIBUTION_CAPTURE_SCRIPT)();
  }

  function setSearch(search: string) {
    vi.stubGlobal('location', { search });
  }

  function setPrerendering(value: boolean) {
    Object.defineProperty(document, 'prerendering', {
      configurable: true,
      value,
    });
  }

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    setPrerendering(false);
    // Reset cookies.
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      writable: true,
      value: '',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fires a keepalive POST to /api/attr when a click ID is present', () => {
    setSearch('?gclid=abc123');

    runScript();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/attr');
    expect(init).toMatchObject({
      method: 'POST',
      keepalive: true,
      credentials: 'same-origin',
      body: 'gclid=abc123',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
    });
  });

  it('forwards only the click-ID params, dropping utm/other query keys', () => {
    setSearch('?utm_source=google&gclid=abc123&foo=bar');

    runScript();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/attr');
    expect(fetchMock.mock.calls[0][1]?.body).toBe('gclid=abc123');
  });

  it('URL-encodes forwarded values', () => {
    setSearch('?gclid=a%20b');

    runScript();

    expect(fetchMock.mock.calls[0][0]).toBe('/api/attr');
    expect(fetchMock.mock.calls[0][1]?.body).toBe('gclid=a%20b');
  });

  it('does not fire when no click IDs are present', () => {
    setSearch('?utm_source=google');

    runScript();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('dedupes on VALUE: skips a click ID whose baci_* cookie already holds the same value', () => {
    setSearch('?gclid=abc123');
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      writable: true,
      value: 'foo=bar; baci_gclid=abc123; baz=qux',
    });

    runScript();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes when the same param carries a DIFFERENT click ID (last-click-wins)', () => {
    setSearch('?gclid=fresh999');
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      writable: true,
      value: 'baci_gclid=stale111',
    });

    runScript();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/attr');
    expect(fetchMock.mock.calls[0][1]?.body).toBe('gclid=fresh999');
  });

  it('forwards a changed value AND a brand-new param together', () => {
    setSearch('?gclid=new&fbclid=fresh');
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      writable: true,
      value: 'baci_gclid=already',
    });

    runScript();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // gclid changed (already→new) and fbclid is new — both refresh.
    expect(fetchMock.mock.calls[0][0]).toBe('/api/attr');
    expect(fetchMock.mock.calls[0][1]?.body).toBe('fbclid=fresh&gclid=new');
  });

  it('skips only the unchanged param, forwarding the changed one', () => {
    setSearch('?gclid=same&fbclid=changed');
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      writable: true,
      value: 'baci_gclid=same; baci_fbclid=old',
    });

    runScript();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/attr');
    expect(fetchMock.mock.calls[0][1]?.body).toBe('fbclid=changed');
  });

  it('does not fire while prerendering, then fires on activation', () => {
    setPrerendering(true);
    setSearch('?gclid=abc123');

    runScript();
    expect(fetchMock).not.toHaveBeenCalled();

    // Activation: prerendering flips false and the event fires.
    setPrerendering(false);
    document.dispatchEvent(new Event('prerenderingchange'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/attr');
    expect(fetchMock.mock.calls[0][1]?.body).toBe('gclid=abc123');
  });

  it('dispatches baci:ad-attribution-updated after /api/attr succeeds', async () => {
    setSearch('?gclid=abc123');
    const onUpdate = vi.fn();
    window.addEventListener('baci:ad-attribution-updated', onUpdate);

    runScript();
    // The dispatch runs in the fetch().then() microtask.
    await Promise.resolve();
    await Promise.resolve();

    expect(onUpdate).toHaveBeenCalledTimes(1);
    window.removeEventListener('baci:ad-attribution-updated', onUpdate);
  });

  it('does not dispatch when /api/attr responds non-ok', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });
    setSearch('?gclid=abc123');
    const onUpdate = vi.fn();
    window.addEventListener('baci:ad-attribution-updated', onUpdate);

    runScript();
    await Promise.resolve();
    await Promise.resolve();

    expect(onUpdate).not.toHaveBeenCalled();
    window.removeEventListener('baci:ad-attribution-updated', onUpdate);
  });
  it('captures X only after a complete marketing grant and retries when consent arrives', () => {
    localStorage.clear();
    setSearch('?twclid=landing_click');
    let retry: EventListener | undefined;
    const listen = vi
      .spyOn(window, 'addEventListener')
      .mockImplementation((name, callback) => {
        if (name === 'cookie-consent-updated')
          retry = callback as EventListener;
      });
    runScript();
    expect(fetchMock).not.toHaveBeenCalled();
    localStorage.setItem(
      'baci-cookie-consent',
      JSON.stringify({
        necessary: true,
        analytics: false,
        marketing: true,
        functional: false,
      })
    );
    retry?.(new Event('cookie-consent-updated'));
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      'twclid=landing_click&marketing_consent=true'
    );
    fetchMock.mockClear();
    document.cookie = 'baci_twclid=landing_click';
    runScript();
    expect(fetchMock).not.toHaveBeenCalled();
    listen.mockRestore();
    localStorage.clear();
  });
  it('does not capture X with incomplete or malformed preference data', () => {
    setSearch('?twclid=landing_click');
    for (const preference of ['{"marketing":true}', 'bad-json']) {
      localStorage.setItem('baci-cookie-consent', preference);
      runScript();
    }
    expect(fetchMock).not.toHaveBeenCalled();
    localStorage.clear();
  });
});
