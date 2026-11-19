// @vitest-environment jsdom
import './test-env.test-setup.mjs';
import { afterEach, describe, expect, it } from 'vitest';
import { cookieClaims } from './page-scripts.mjs';

function setCookie(value) {
  document.cookie = `cw_conversation=${value}; path=/`;
}
afterEach(() => {
  document.cookie = 'cw_conversation=; path=/; max-age=0';
});

describe('cookieClaims', () => {
  it('decodes the claims segment of the conversation cookie', () => {
    const payload = btoa(JSON.stringify({ inbox_id: 7 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    setCookie(`h.${payload}.s`);
    expect(cookieClaims()).toEqual({ inbox_id: 7 });
  });

  it('returns null without a cookie, without a payload, or with invalid JSON', () => {
    expect(cookieClaims()).toBeNull();
    setCookie('nopayload');
    expect(cookieClaims()).toBeNull();
    setCookie(`h.${btoa('not json')}.s`);
    expect(cookieClaims()).toBeNull();
  });
});
