import { NextRequest, NextResponse } from 'next/server';
import { expect, it, vi } from 'vitest';
import { generateCSP, generateStorefrontCspReportOnlyCandidate } from './csp';
import { applySecurityHeaders } from './response-headers';

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
  expect(directive(candidate, 'form-action')).toEqual(
    directive(enforced, 'form-action')
  );
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

it('does not add form-action without checkout evidence', () => {
  const candidate = requireCandidate(
    generateStorefrontCspReportOnlyCandidate(
      "script-src 'self' 'unsafe-inline'"
    )
  );

  expect(candidate).not.toContain('form-action');
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

it('uses none when unsafe sources were the only script execution sources', () => {
  const candidate = requireCandidate(
    generateStorefrontCspReportOnlyCandidate(
      "script-src 'UNSAFE-INLINE' 'UNSAFE-EVAL'; script-src-elem 'unsafe-inline' 'unsafe-eval'"
    )
  );

  expect(directive(candidate, 'script-src')).toEqual(["'none'"]);
  expect(directive(candidate, 'script-src-elem')).toEqual(["'none'"]);
});

it('removes the local eval exception and preserves existing form-action', () => {
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
  expect(directive(candidate, 'form-action')).toEqual([
    'https://provider.example',
  ]);
  expect(directive(candidate, 'form-action')).toHaveLength(1);
  expect(
    candidate.split('; ').filter((part) => part.startsWith('script-src-attr '))
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
  expect(directive(candidate, 'form-action')).toEqual([
    'https://provider.example',
  ]);
  expect(
    candidate
      .split(';')
      .filter((part) => part.trim().startsWith('script-src-attr '))
  ).toHaveLength(1);
  expect(directive(candidate, 'form-action')).toHaveLength(1);
});

it('keeps the enforced policy intact while previewing storefront CSP locally by opt-in', () => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('BACI_CSP_REPORT_ONLY_PREVIEW', 'true');
  try {
    const request = new NextRequest(
      'http://localhost:3000/checkout?customer=private-value'
    );
    const response = applySecurityHeaders(
      NextResponse.next(),
      '/checkout',
      'Mozilla',
      'storefront',
      true,
      undefined,
      request,
      'localhost'
    );
    const enforced = response.headers.get('Content-Security-Policy') ?? '';
    const candidate =
      response.headers.get('Content-Security-Policy-Report-Only') ?? '';
    const candidateScript = candidate
      .split('; ')
      .find((directive) => directive.startsWith('script-src '));

    expect(enforced).toContain("script-src 'self' 'unsafe-inline'");
    expect(candidateScript).toBeDefined();
    expect(candidateScript).not.toContain("'unsafe-inline'");
    expect(candidate).toContain("script-src-attr 'none'");
    expect(candidate).not.toContain('form-action');
    expect(enforced).not.toContain('form-action');
    expect(candidate).toContain('https://checkout.creditdirect.ng');
    expect(candidate).toContain('https://checkout.useklump.com');
    expect(candidate).not.toContain('private-value');
    expect(candidate).not.toContain('http://localhost:3000');
    expect(candidate).not.toContain('report-uri');
    expect(candidate).not.toContain('report-to');
  } finally {
    vi.unstubAllEnvs();
  }
});

it.each([
  {
    gate: 'production',
    nodeEnv: 'production',
    routeType: 'storefront',
    isLocal: true,
  },
  {
    gate: 'remote host',
    nodeEnv: 'test',
    routeType: 'storefront',
    isLocal: false,
  },
  { gate: 'API route', nodeEnv: 'test', routeType: 'api', isLocal: true },
] as const)('keeps the report-only preview off for $gate', ({
  nodeEnv,
  routeType,
  isLocal,
}) => {
  vi.stubEnv('BACI_CSP_REPORT_ONLY_PREVIEW', 'true');
  vi.stubEnv('NODE_ENV', nodeEnv);
  try {
    const response = applySecurityHeaders(
      NextResponse.next(),
      routeType === 'api' ? '/api/checkout' : '/checkout',
      'Mozilla',
      routeType,
      isLocal
    );
    expect(
      response.headers.get('Content-Security-Policy-Report-Only')
    ).toBeNull();
  } finally {
    vi.unstubAllEnvs();
  }
});

it.each([
  undefined,
  'false',
])('keeps the report-only preview off for opt-in value %s', (flag) => {
  vi.stubEnv('BACI_CSP_REPORT_ONLY_PREVIEW', flag);
  vi.stubEnv('NODE_ENV', 'test');
  try {
    const response = applySecurityHeaders(
      NextResponse.next(),
      '/checkout',
      'Mozilla',
      'storefront',
      true
    );

    expect(
      response.headers.get('Content-Security-Policy-Report-Only')
    ).toBeNull();
    expect(response.headers.get('Content-Security-Policy')).toContain(
      "script-src 'self' 'unsafe-inline'"
    );
  } finally {
    vi.unstubAllEnvs();
  }
});

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
