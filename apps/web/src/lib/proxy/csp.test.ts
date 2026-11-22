import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installExperienceExecutionOrigin } from '@/lib/experience/execution-origin-runtime';
import {
  buildStrictCspResponse,
  generateCSP,
  generateStorefrontCspReportOnlyCandidate,
  shouldForwardStrictCspNonce,
} from './csp';

describe('proxy CSP', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('uses a nonce only for admin and auth document routes', () => {
    expect(shouldForwardStrictCspNonce('admin')).toBe(true);
    expect(shouldForwardStrictCspNonce('storefront')).toBe(false);
    expect(generateCSP('admin', false, 'safe_nonce')).toContain(
      "'nonce-safe_nonce'"
    );
    expect(generateCSP('storefront', false)).toContain("'unsafe-inline'");
  });

  it('forwards exactly the generated strict CSP to the request', () => {
    const { nonce, response } = buildStrictCspResponse(
      new NextRequest('https://usebaci.com/dashboard'),
      'admin',
      false
    );
    const forwarded = response.headers.get(
      'x-middleware-request-content-security-policy'
    );
    expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(forwarded).toContain(`'nonce-${nonce}'`);
  });

  it('builds a narrower storefront script candidate without changing payment origins', () => {
    const enforced = generateCSP('storefront', false);
    const candidate = requireCandidate(
      generateStorefrontCspReportOnlyCandidate(enforced)
    );
    const enforcedScript = directive(enforced, 'script-src');
    const candidateScript = directive(candidate, 'script-src');

    expect(enforcedScript).toContain("'unsafe-inline'");
    expect(candidateScript).not.toContain("'unsafe-inline'");
    expect(directive(candidate, 'script-src-attr')).toEqual(["'none'"]);
    expect(directive(candidate, 'form-action')).toEqual(["'self'"]);
    expect(candidateScript).toEqual(
      enforcedScript.filter((source) => source !== "'unsafe-inline'")
    );
    for (const origin of [
      'https://checkout.creditdirect.ng',
      'https://checkout.useklump.com',
    ]) {
      expect(candidate).toContain(origin);
    }
    expect(candidate).not.toContain('report-uri');
    expect(candidate).not.toContain('report-to');
  });

  it('does not produce a report-only candidate without an input script-src', () => {
    expect(
      generateStorefrontCspReportOnlyCandidate("default-src 'self'")
    ).toBeNull();
  });

  it('removes reporting directives and unsafe sources from script-src-elem', () => {
    const candidate = requireCandidate(
      generateStorefrontCspReportOnlyCandidate(
        "script-src 'self' 'unsafe-inline'; script-src-elem 'self' 'unsafe-inline' 'unsafe-eval' https://scripts.example; report-uri https://reports.example/csp?tenant=private; report-to private-endpoint"
      )
    );

    expect(directive(candidate, 'script-src-elem')).toEqual([
      "'self'",
      'https://scripts.example',
    ]);
    expect(candidate).not.toMatch(
      /report-uri|report-to|reports\.example|private-endpoint|tenant=private/
    );
  });

  it('removes the local eval exception and replaces duplicate candidate directives', () => {
    const local = generateCSP('storefront', true);
    const candidate = requireCandidate(
      generateStorefrontCspReportOnlyCandidate(
        `${local}; script-src-attr 'unsafe-inline'; form-action https://provider.example`
      )
    );
    const script = directive(candidate, 'script-src');

    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(directive(candidate, 'script-src-attr')).toEqual(["'none'"]);
    expect(directive(candidate, 'form-action')).toEqual(["'self'"]);
    expect(
      candidate.split('; ').filter((part) => part.startsWith('form-action '))
    ).toHaveLength(1);
    expect(
      candidate
        .split('; ')
        .filter((part) => part.startsWith('script-src-attr '))
    ).toHaveLength(1);
  });

  it('parses candidate directives across semicolon and whitespace variations', () => {
    const candidate = requireCandidate(
      generateStorefrontCspReportOnlyCandidate(
        "  SCRIPT-SRC\t'self'   'unsafe-inline'\n'unsafe-eval' https://cdn.example ;\n script-src-attr\t'unsafe-inline' ; FORM-ACTION  https://provider.example ; "
      )
    );

    expect(directive(candidate, 'script-src')).toEqual([
      "'self'",
      'https://cdn.example',
    ]);
    expect(directive(candidate, 'script-src-attr')).toEqual(["'none'"]);
    expect(directive(candidate, 'form-action')).toEqual(["'self'"]);
    expect(
      candidate
        .split(';')
        .filter((part) => part.trim().startsWith('script-src-attr '))
    ).toHaveLength(1);
    expect(
      candidate
        .split(';')
        .filter((part) => part.trim().startsWith('form-action '))
    ).toHaveLength(1);
  });

  it('allows only an explicitly enabled, normalized Chatwoot platform origin on storefronts', () => {
    vi.stubEnv('EKAETTE_CHATWOOT_CONTEXT_ENABLED', 'true');
    vi.stubEnv('EKAETTE_CHATWOOT_WIDGET_ENABLED', 'true');
    vi.stubEnv(
      'EKAETTE_CHATWOOT_CONTEXT_BINDINGS',
      JSON.stringify([
        {
          merchantId: '11111111-1111-4111-8111-111111111111',
          origin: 'https://shop.example.com',
          websiteToken: 'public-widget-token-123456',
          inboxId: 42,
        },
      ])
    );
    vi.stubEnv(
      'EKAETTE_CHATWOOT_PLATFORM_ORIGIN',
      'https://support.example.com:443/'
    );

    const policy = generateCSP(
      'storefront',
      false,
      undefined,
      undefined,
      undefined,
      false,
      'shop.example.com'
    );
    for (const name of ['script-src', 'connect-src', 'frame-src']) {
      expect(directive(policy, name)).toContain('https://support.example.com');
    }
    expect(directive(policy, 'connect-src')).toContain(
      'wss://support.example.com'
    );
    const unboundPolicy = generateCSP(
      'storefront',
      false,
      undefined,
      undefined,
      undefined,
      false,
      'other.example.com'
    );
    for (const name of ['script-src', 'connect-src', 'frame-src']) {
      expect(directive(unboundPolicy, name)).not.toContain(
        'https://support.example.com'
      );
    }
    for (const route of ['admin', 'auth', 'api'] as const) {
      expect(generateCSP(route, false, 'test_nonce')).not.toContain(
        'https://support.example.com'
      );
    }
  });

  it('keeps Chatwoot out of CSP while disabled or configured with an unsafe origin', () => {
    vi.stubEnv('EKAETTE_CHATWOOT_CONTEXT_ENABLED', 'true');
    vi.stubEnv('EKAETTE_CHATWOOT_WIDGET_ENABLED', 'false');
    vi.stubEnv(
      'EKAETTE_CHATWOOT_CONTEXT_BINDINGS',
      JSON.stringify([
        {
          merchantId: '11111111-1111-4111-8111-111111111111',
          origin: 'https://shop.example.com',
          websiteToken: 'public-widget-token-123456',
          inboxId: 42,
        },
      ])
    );
    vi.stubEnv(
      'EKAETTE_CHATWOOT_PLATFORM_ORIGIN',
      'https://support.example.com'
    );
    expect(generateCSP('storefront', false)).not.toContain(
      'https://support.example.com'
    );

    vi.stubEnv('EKAETTE_CHATWOOT_CONTEXT_ENABLED', 'true');
    vi.stubEnv('EKAETTE_CHATWOOT_WIDGET_ENABLED', 'true');
    vi.stubEnv(
      'EKAETTE_CHATWOOT_PLATFORM_ORIGIN',
      'https://support.example.com/path'
    );
    expect(generateCSP('storefront', false)).not.toContain(
      'https://support.example.com'
    );
  });
});

const socialScriptOrigins = [
  'https://connect.facebook.net',
  'https://analytics.tiktok.com',
  'https://sc-static.net',
  'https://tr.snapchat.com',
  'https://static.ads-twitter.com',
];
const socialCollectorOrigins = [
  'https://www.facebook.com',
  'https://analytics.tiktok.com',
  'https://tr.snapchat.com',
  'https://tr6.snapchat.com',
  'https://analytics.twitter.com',
  'https://analytics.x.com',
  'https://t.co',
];
function directive(policy: string, name: string): string[] {
  return (
    policy
      .split('; ')
      .find((part) => part.startsWith(`${name} `))
      ?.split(' ')
      .slice(1) ?? []
  );
}
function requireCandidate(candidate: string | null): string {
  expect(candidate).not.toBeNull();
  if (!candidate) throw new Error('Expected a report-only CSP candidate');
  return candidate;
}
it.each([
  true,
  false,
])('does not allow the retired CredPal service on storefronts (local=%s)', (isLocal) => {
  const policy = generateCSP('storefront', isLocal);
  for (const name of ['script-src', 'connect-src', 'frame-src']) {
    expect(directive(policy, name)).not.toContain(
      'https://checkout.credpal.com'
    );
    expect(directive(policy, name)).not.toContain('https://api.credpal.com');
  }
  expect(directive(policy, 'frame-src')).toContain(
    'https://checkout.creditdirect.ng'
  );
});
it.each([
  false,
  true,
])('lets storefronts open the Supabase Realtime socket for shared-cart live updates (local=%s)', (isLocal) => {
  // Browsers do not treat an https: source as covering wss:, so the cart's
  // private Realtime channel needs its own source. Without it the browser
  // blocks the connection and shoppers never receive cart-change notices.
  const sources = directive(generateCSP('storefront', isLocal), 'connect-src');
  expect(sources).toContain('wss://*.supabase.co');
  expect(sources).toContain('https://*.supabase.co');
  // No blanket WebSocket allowance: only the Supabase project hosts.
  expect(sources).not.toContain('wss:');
  expect(sources.filter((source) => source.startsWith('wss:'))).toEqual([
    'wss://*.supabase.co',
  ]);
});

it.each([
  false,
  true,
])('lets storefronts play a video the shopper just picked (local=%s)', (isLocal) => {
  // The swap device check reads still frames from the shopper's own clip
  // through a blob: URL. An https: source does not cover blob:, so without it
  // the browser refuses to load the clip and every normal-size video fails.
  expect(directive(generateCSP('storefront', isLocal), 'media-src')).toEqual([
    "'self'",
    'blob:',
    'https:',
  ]);
});

it('keeps blob: media off admin and auth documents', () => {
  for (const routeType of ['admin', 'auth'] as const) {
    expect(directive(generateCSP(routeType, false), 'media-src')).toEqual([
      "'self'",
      'https:',
    ]);
  }
});

it('permits consent-gated social SDKs and collectors only on storefronts', () => {
  const policy = generateCSP('storefront', false);
  expect(directive(policy, 'script-src')).toEqual(
    expect.arrayContaining(socialScriptOrigins)
  );
  expect(directive(policy, 'connect-src')).toEqual(
    expect.arrayContaining(socialCollectorOrigins)
  );
  expect(directive(policy, 'script-src')).not.toContain("'unsafe-eval'");
  expect(directive(policy, 'default-src')).toEqual(["'self'"]);
  for (const source of [
    ...directive(policy, 'script-src'),
    ...directive(policy, 'connect-src'),
  ]) {
    expect(source).not.toMatch(
      /\*\.(facebook|tiktok|snapchat|twitter|x)\.(com|net)/
    );
  }
});
it.each([
  'admin',
  'auth',
  'api',
] as const)('keeps social SDKs and collectors out of %s CSP', (route) => {
  const policy = generateCSP(route, false, 'test_nonce');
  for (const origin of [...socialScriptOrigins, ...socialCollectorOrigins])
    expect(policy).not.toContain(origin);
  if (route !== 'api') {
    expect(directive(policy, 'script-src')).toContain("'nonce-test_nonce'");
    expect(directive(policy, 'script-src')).not.toContain("'unsafe-inline'");
  }
});

it('allows the Snapchat SDK dynamic configuration script only on storefronts', () => {
  const configurationScript = new URL(
    'https://tr.snapchat.com/config/com/11111111-1111-4111-8111-111111111111.js'
  );
  expect(directive(generateCSP('storefront', false), 'script-src')).toContain(
    configurationScript.origin
  );
  for (const route of ['admin', 'auth', 'api'] as const)
    expect(
      directive(generateCSP(route, false, 'nonce'), 'script-src')
    ).not.toContain(configurationScript.origin);
});

it('limits execution framing to storefronts and the private builder subtree', () => {
  const uninstall = installExperienceExecutionOrigin(
    'https://execution.example.net'
  );
  try {
    expect(generateCSP('storefront', false)).toContain(
      'https://execution.example.net'
    );
    for (const type of ['admin', 'auth', 'api'] as const)
      expect(generateCSP(type, false)).not.toContain(
        'https://execution.example.net'
      );
    expect(
      buildStrictCspResponse(
        new NextRequest('https://usebaci.com/builder/experience/preview'),
        'admin',
        false
      ).response.headers.get('x-middleware-request-content-security-policy')
    ).toContain('https://execution.example.net');
    expect(
      buildStrictCspResponse(
        new NextRequest('https://usebaci.com/dashboard'),
        'admin',
        false
      ).response.headers.get('x-middleware-request-content-security-policy')
    ).not.toContain('https://execution.example.net');
  } finally {
    uninstall();
  }
});
