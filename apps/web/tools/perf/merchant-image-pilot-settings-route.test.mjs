import { describe, expect, it } from 'vitest';
import { verifyRecordedRoute } from './merchant-image-pilot-settings-route.mjs';

describe('merchant-image-pilot-settings-route', () => {
  const route = 'http://localhost:3000/pilot-lab/store/id?arm=pilot';

  it('binds every HAR page to the expected route', () => {
    expect(
      verifyRecordedRoute([{ _url: route }, { title: route }], route)
    ).toEqual({ ok: true });
    expect(
      verifyRecordedRoute([{ _url: route }, { _url: `${route}&x=1` }], route)
        .error
    ).toMatch(/navigated .* expected /);
    expect(verifyRecordedRoute([], route).error).toMatch(/no pages/);
    expect(verifyRecordedRoute([{}], route).error).toMatch(/no navigation URL/);
    expect(verifyRecordedRoute([{ title: 'u run 1' }], route).error).toMatch(
      /not a valid URL/
    );
    expect(verifyRecordedRoute([{ _url: route }], '::bad::').error).toMatch(
      /bad --expect-route/
    );
  });

  it('binds Lighthouse navigations and redirect results to the route', () => {
    const report = { finalDisplayedUrl: route, requestedUrl: route };
    expect(verifyRecordedRoute(report, route, 'lighthouse')).toEqual({
      ok: true,
    });
    expect(
      verifyRecordedRoute(
        { ...report, requestedUrl: `${route}&x=1` },
        route,
        'lighthouse'
      ).error
    ).toMatch(/requestedUrl is .* expected /);
    expect(
      verifyRecordedRoute(
        { ...report, finalDisplayedUrl: 'http://localhost:3000/other' },
        route,
        'lighthouse'
      ).error
    ).toMatch(/finalDisplayedUrl is .* expected /);
    expect(verifyRecordedRoute({}, route, 'lighthouse').error).toMatch(
      /no requestedUrl/
    );
    expect(
      verifyRecordedRoute(
        { ...report, requestedUrl: 'u run 1' },
        route,
        'lighthouse'
      ).error
    ).toMatch(/not a valid URL/);
    expect(verifyRecordedRoute(report, '::bad::', 'lighthouse').error).toMatch(
      /bad --expect-route/
    );
  });
});
