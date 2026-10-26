import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { AD_TRACKING_COOKIES } from '@/lib/ad-tracking-cookies';
import { POST } from './route';

const ORIGIN = 'https://ogabassey.com/api/attr';

// 90 days, matching ad-tracking-cookies.ts COOKIE_MAX_AGE (90 * 24 * 60 * 60).
const NINETY_DAYS_SECONDS = 7_776_000;

function requestFor(body: string): NextRequest {
  return new NextRequest(ORIGIN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
}

describe('POST /api/attr', () => {
  it('returns 204 with no body and no-store on a valid single click ID', async () => {
    const response = await POST(requestFor('gclid=Cj0KCQjw_abc-123'));

    expect(response.status).toBe(204);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('sets the exact baci_gclid cookie contract', async () => {
    const response = await POST(requestFor('gclid=abc123'));
    const setCookies = response.headers.getSetCookie();

    expect(setCookies).toHaveLength(1);
    expect(setCookies[0]).toBe(
      `${AD_TRACKING_COOKIES.GOOGLE_CLICK_ID}=abc123; Path=/; Max-Age=${NINETY_DAYS_SECONDS}; SameSite=Lax; Secure`
    );
  });

  it('sets one cookie per click ID when several are present', async () => {
    const response = await POST(
      requestFor('fbclid=fb1&ttclid=tt1&gclid=g1&sccid=sc1')
    );
    const setCookies = response.headers.getSetCookie();

    expect(setCookies).toHaveLength(4);
    const names = setCookies.map((c) => c.split('=')[0]);
    expect(names.sort()).toEqual(
      [
        AD_TRACKING_COOKIES.FACEBOOK_CLICK_ID,
        AD_TRACKING_COOKIES.TIKTOK_CLICK_ID,
        AD_TRACKING_COOKIES.GOOGLE_CLICK_ID,
        AD_TRACKING_COOKIES.SNAPCHAT_CLICK_ID,
      ].sort()
    );
  });

  it('URL-encodes the cookie value', async () => {
    // A tilde is URL-safe per the schema but encodeURIComponent leaves it as-is;
    // assert a dot/underscore/hyphen token round-trips unescaped.
    const response = await POST(requestFor('gclid=a.b_c-d~e'));
    const setCookies = response.headers.getSetCookie();

    expect(setCookies[0]).toContain(
      `${AD_TRACKING_COOKIES.GOOGLE_CLICK_ID}=a.b_c-d~e;`
    );
  });

  it('returns 400 + no-store and sets no cookie for unknown params', async () => {
    const response = await POST(requestFor('utm_source=google'));

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.getSetCookie()).toHaveLength(0);
  });

  it('returns 400 when a known click ID rides alongside an unknown param', async () => {
    // The inline script filters to known params before calling, so a mixed
    // query reaching the endpoint is tampering — reject it, do not set cookies.
    const response = await POST(requestFor('gclid=abc&utm_source=google'));

    expect(response.status).toBe(400);
    expect(response.headers.getSetCookie()).toHaveLength(0);
  });

  it('returns 400 with no click IDs present', async () => {
    const response = await POST(requestFor(''));

    expect(response.status).toBe(400);
  });

  it('returns 400 for an over-length value', async () => {
    const response = await POST(requestFor(`gclid=${'a'.repeat(257)}`));

    expect(response.status).toBe(400);
    expect(response.headers.getSetCookie()).toHaveLength(0);
  });

  it('returns 400 for a value with unsupported characters', async () => {
    const response = await POST(requestFor('gclid=has%20space'));

    expect(response.status).toBe(400);
  });
});

it('requires an explicit marketing grant before persisting X attribution', async () => {
  expect((await POST(requestFor('twclid=landing_click'))).status).toBe(400);
  const response = await POST(
    requestFor('twclid=landing_click&marketing_consent=true')
  );
  expect(response.status).toBe(204);
  expect(response.headers.getSetCookie()).toEqual([
    'baci_twclid=landing_click; Path=/; Max-Age=7776000; SameSite=Lax; Secure',
  ]);
  expect((await POST(requestFor('marketing_consent=true'))).status).toBe(400);
});
