import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import {
  isPlatformSpecialRoutingEligible,
  runPlatformCanonicalRoutingStage,
  runPlatformRoutingStage,
} from './platform-routing';

describe('platform routing stages', () => {
  it('preserves well-known paths and marks them as special routing', async () => {
    const request = new NextRequest(
      'https://usebaci.com/.well-known/apple-app-site-association'
    );
    expect(
      isPlatformSpecialRoutingEligible(
        '/.well-known/apple-app-site-association',
        'usebaci.com'
      )
    ).toBe(true);
    expect(
      (
        await runPlatformRoutingStage(
          request,
          '/.well-known/apple-app-site-association',
          'usebaci.com',
          'Mozilla'
        )
      )?.headers.get('x-middleware-next')
    ).toBe('1');
  });

  it('canonicalizes mixed-case storefront documents but not API route case', () => {
    expect(
      runPlatformCanonicalRoutingStage(
        new NextRequest('https://usebaci.com/Phones/Iphone'),
        '/Phones/Iphone',
        'usebaci.com'
      )?.headers.get('location')
    ).toBe('https://usebaci.com/phones/iphone');
    expect(
      runPlatformCanonicalRoutingStage(
        new NextRequest('https://usebaci.com/API/Orders'),
        '/API/Orders',
        'usebaci.com'
      )
    ).toBeNull();
  });
});
