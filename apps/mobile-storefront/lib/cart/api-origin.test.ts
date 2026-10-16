import { isAllowedCartApiProtocol } from './api-origin';

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

  it('rejects plain HTTP to public hosts and non-HTTP schemes', () => {
    expect(isAllowedCartApiProtocol(new URL('http://api.usebaci.com'))).toBe(
      false
    );
    expect(
      isAllowedCartApiProtocol(new URL('http://192.168.100.70.evil.test'))
    ).toBe(false);
  });
});
