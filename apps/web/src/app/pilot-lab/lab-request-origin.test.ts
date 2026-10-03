import { afterEach, describe, expect, it, vi } from 'vitest';
import { labRequestOrigin } from './lab-request-origin';

describe('labRequestOrigin', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reflects loopback hosts with the first proto token', () => {
    expect(labRequestOrigin({ host: 'localhost:3122', proto: 'http' })).toBe(
      'http://localhost:3122'
    );
    expect(
      labRequestOrigin({ host: '127.0.0.1:3122', proto: 'HTTPS, http' })
    ).toBe('https://127.0.0.1:3122');
    expect(labRequestOrigin({ host: 'LOCALHOST', proto: null })).toBe(
      'http://localhost'
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
      expect(labRequestOrigin({ host, proto: 'https' })).toBe(
        'http://localhost:3000'
      );
    }
    expect(labRequestOrigin({ host: null, proto: 'https' })).toBe(
      'http://localhost:3000'
    );
    expect(labRequestOrigin({ host: 'not a host!!', proto: 'https' })).toBe(
      'http://localhost:3000'
    );
  });

  it('prefers the operator origin override when valid', () => {
    vi.stubEnv('BACI_IMAGE_PILOT_ORIGIN', 'https://lab-assets.example/cdn');
    expect(labRequestOrigin({ host: 'evil.com', proto: 'http' })).toBe(
      'https://lab-assets.example'
    );
  });

  it('ignores a malformed origin override', () => {
    for (const override of ['notaurl', 'ftp://lab.example', '']) {
      vi.stubEnv('BACI_IMAGE_PILOT_ORIGIN', override);
      expect(labRequestOrigin({ host: 'evil.com', proto: 'http' })).toBe(
        'http://localhost:3000'
      );
    }
  });
});
