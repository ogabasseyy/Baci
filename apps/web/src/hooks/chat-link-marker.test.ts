import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  linkMarkerCookieName,
  readLinkMarker,
  writeLinkMarker,
} from './chat-link-marker';

const clearCookies = () => {
  for (const entry of document.cookie.split(';')) {
    const name = entry.split('=')[0]?.trim();
    // biome-ignore lint/suspicious/noDocumentCookie: test cleanup of marker cookies
    if (name) document.cookie = `${name}=; Path=/; Max-Age=0`;
  }
};

beforeEach(() => {
  window.localStorage.clear();
  clearCookies();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('link marker', () => {
  it('is off until a link is recorded, then on, then off again', () => {
    expect(readLinkMarker('ogabassey')).toBe(false);

    writeLinkMarker('ogabassey', true);
    expect(readLinkMarker('ogabassey')).toBe(true);

    writeLinkMarker('ogabassey', false);
    expect(readLinkMarker('ogabassey')).toBe(false);
  });

  it('keeps one record per store', () => {
    writeLinkMarker('store-a', true);
    expect(readLinkMarker('store-a')).toBe(true);
    expect(readLinkMarker('store-b')).toBe(false);

    writeLinkMarker('store-b', true);
    writeLinkMarker('store-a', false);
    expect(readLinkMarker('store-a')).toBe(false);
    expect(readLinkMarker('store-b')).toBe(true);
  });

  it('bugfix: store names that differ only in punctuation never share a record', () => {
    expect(linkMarkerCookieName('a/b')).not.toBe(linkMarkerCookieName('a_b'));
    expect(linkMarkerCookieName('a.b')).not.toBe(linkMarkerCookieName('a_b'));
    expect(linkMarkerCookieName('a/b')).not.toBe(
      linkMarkerCookieName('a.2f.b')
    );

    writeLinkMarker('a/b', true);
    expect(readLinkMarker('a/b')).toBe(true);
    expect(readLinkMarker('a_b')).toBe(false);
    writeLinkMarker('a_b', true);
    writeLinkMarker('a/b', false);
    expect(readLinkMarker('a_b')).toBe(true);
  });

  it('writes a cookie that is valid for the whole site and lasts 30 days', () => {
    const setter = vi.spyOn(document, 'cookie', 'set');
    writeLinkMarker('ogabassey', true);
    const written = String(setter.mock.calls[0]?.[0]);
    expect(written).toContain(`${linkMarkerCookieName('ogabassey')}=1`);
    expect(written).toContain('Path=/');
    expect(written).toContain(`Max-Age=${60 * 60 * 24 * 30}`);
    expect(written).toContain('SameSite=Lax');
  });

  it('reads the record from local storage alone when the cookie is missing', () => {
    window.localStorage.setItem('baci-chat-link:ogabassey', '1');
    expect(readLinkMarker('ogabassey')).toBe(true);
  });

  it('reads the record from the cookie alone when local storage is blocked', () => {
    writeLinkMarker('ogabassey', true);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readLinkMarker('ogabassey')).toBe(true);
  });

  it('bugfix: still records and clears the link when local storage refuses every write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(() => writeLinkMarker('ogabassey', true)).not.toThrow();
    expect(readLinkMarker('ogabassey')).toBe(true);

    expect(() => writeLinkMarker('ogabassey', false)).not.toThrow();
    expect(readLinkMarker('ogabassey')).toBe(false);
  });

  it('reports no record, without throwing, when neither place can be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readLinkMarker('nobody')).toBe(false);
  });
});
