import { isAllowedCartApiProtocol, resolveCartApiOrigin } from './api-origin';

describe('resolveCartApiOrigin', () => {
  it('maps the platform apex to its programmatic cart surface', () => {
    expect(resolveCartApiOrigin('https://usebaci.com')).toBe(
      'https://api.usebaci.com'
    );
  });

  it('passes recognized programmatic platform hosts through unchanged', () => {
    expect(resolveCartApiOrigin('https://api.usebaci.com')).toBe(
      'https://api.usebaci.com'
    );
    expect(resolveCartApiOrigin('https://api-staging.usebaci.com')).toBe(
      'https://api-staging.usebaci.com'
    );
  });

  it('resolves custom white-label origins to the configured platform root API host', () => {
    expect(
      resolveCartApiOrigin('https://shop.example.com', 'usebaci.com')
    ).toBe('https://api.usebaci.com');
    expect(
      resolveCartApiOrigin('https://shop.example.com', 'example.com')
    ).toBe('https://api.example.com');
    expect(
      resolveCartApiOrigin('https://api-staging.example.com', 'example.com')
    ).toBe('https://api-staging.example.com');
  });

  it('rejects unsupported custom origins and malformed URLs when no trusted programmatic root is configured', () => {
    expect(resolveCartApiOrigin('https://shop.example.com')).toBe('');
    expect(
      resolveCartApiOrigin('https://shop.example.com', 'https://bad-root')
    ).toBe('');
    expect(resolveCartApiOrigin('not a url')).toBe('');
  });

  it('maps the hosted staging host to its programmatic cart surface', () => {
    expect(resolveCartApiOrigin('https://staging.ogabassey.com')).toBe(
      'https://api-staging.ogabassey.com'
    );
  });

  it('allows local LAN dev origins in dev builds', () => {
    expect(resolveCartApiOrigin('http://192.168.100.70:4193')).toBe(
      'http://192.168.100.70:4193'
    );
  });
});

describe('cart API origin transport policy', () => {
  it('allows HTTPS origins in any build', () => {
    expect(isAllowedCartApiProtocol(new URL('https://api.usebaci.com'))).toBe(
      true
    );
    expect(isAllowedCartApiProtocol(new URL('https://shop.example.com'))).toBe(
      true
    );
  });

  it('allows the documented local LAN transport in dev builds', () => {
    expect(
      isAllowedCartApiProtocol(new URL('http://192.168.100.70:4193'))
    ).toBe(true);
    expect(isAllowedCartApiProtocol(new URL('http://localhost:4193'))).toBe(
      true
    );
    expect(isAllowedCartApiProtocol(new URL('http://10.0.0.4:4193'))).toBe(
      true
    );
    expect(isAllowedCartApiProtocol(new URL('http://[::1]:4193'))).toBe(true);
  });

  it('rejects plain HTTP to LAN-suffix look-alike hostnames', () => {
    expect(
      isAllowedCartApiProtocol(new URL('http://192.168.1.20.evil.test:4193'))
    ).toBe(false);
    expect(
      isAllowedCartApiProtocol(new URL('http://10.0.0.5.evil.test:4193'))
    ).toBe(false);
  });

  it('rejects plain HTTP to public hosts and non-HTTP schemes', () => {
    expect(isAllowedCartApiProtocol(new URL('http://api.usebaci.com'))).toBe(
      false
    );
    expect(
      isAllowedCartApiProtocol(new URL('http://192.168.100.70.evil.test'))
    ).toBe(false);
  });
});
