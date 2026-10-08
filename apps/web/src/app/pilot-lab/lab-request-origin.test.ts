import { afterEach, describe, expect, it, vi } from 'vitest';
import { labRequestOrigin } from './lab-request-origin';

describe('labRequestOrigin', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('pins request-derived loopback origins to http', () => {
    expect(labRequestOrigin({ host: 'localhost:3122' })).toBe(
      'http://localhost:3122'
    );
    // No proto input exists: request-derived origins always pin http.
    expect(labRequestOrigin({ host: '127.0.0.1:3122' })).toBe(
      'http://127.0.0.1:3122'
    );
    expect(labRequestOrigin({ host: 'LOCALHOST' })).toBe('http://localhost');
  });

  it('collapses localhost subdomains to the canonical origin', () => {
    // A request-supplied subdomain must never reach rendered URLs, even
    // inside the loopback namespace — and neither must its port: the
    // collapsed host is synthesized, so the whole origin is synthesized
    // (Host evil-sub.localhost:6666 cannot mint image URLs for port
    // 6666). Lab routes are path-based, so nothing needs the subdomain.
    expect(labRequestOrigin({ host: 'evil-sub.localhost:4000' })).toBe(
      'http://localhost:3000'
    );
    expect(labRequestOrigin({ host: 'store.localhost' })).toBe(
      'http://localhost:3000'
    );
    // Bare loopback names and IPs echo unchanged: the client literally
    // addressed that host:port, which is what makes local runs on any
    // port render working absolute URLs.
    expect(labRequestOrigin({ host: 'localhost:4000' })).toBe(
      'http://localhost:4000'
    );
    expect(labRequestOrigin({ host: '127.0.0.1:4000' })).toBe(
      'http://127.0.0.1:4000'
    );
  });

  it('never reflects non-loopback hosts', () => {
    // Attacker-controlled Host must not reach rendered image URLs, even
    // normalized: untrusted hosts fall back to loopback.
    for (const host of [
      'shop.example:3101',
      'shop.example',
      'Shop.Example/evil',
      'evil.com',
      'localhost.evil.com',
    ]) {
      expect(labRequestOrigin({ host })).toBe('http://localhost:3000');
    }
    expect(labRequestOrigin({ host: null })).toBe('http://localhost:3000');
    expect(labRequestOrigin({ host: 'not a host!!' })).toBe(
      'http://localhost:3000'
    );
  });

  it('prefers the operator origin override when valid', () => {
    vi.stubEnv('BACI_IMAGE_PILOT_ORIGIN', 'https://lab-assets.example/cdn');
    expect(labRequestOrigin({ host: 'evil.com' })).toBe(
      'https://lab-assets.example'
    );
  });

  it('ignores a malformed origin override', () => {
    for (const override of ['notaurl', 'ftp://lab.example', '']) {
      vi.stubEnv('BACI_IMAGE_PILOT_ORIGIN', override);
      expect(labRequestOrigin({ host: 'evil.com' })).toBe(
        'http://localhost:3000'
      );
    }
  });
});
