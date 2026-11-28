import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-catalog-fixture';
import {
  buildContentSecurityPolicyHeader,
  summarizeCspGovernance,
} from './csp-header';

describe('csp-header', () => {
  it('enforces form-action none, base-uri none, object-src none, and isolates composable vs full-code frame-ancestors', () => {
    const fullCode = createOgabasseyStorefrontManifest();
    fullCode.hostOrigin = 'https://shop.ogabassey.com';
    const fullCsp = buildContentSecurityPolicyHeader(fullCode);
    expect(fullCsp).toContain("form-action 'none'");
    expect(fullCsp).toContain("base-uri 'none'");
    expect(fullCsp).toContain("object-src 'none'");
    expect(fullCsp).toContain("frame-src 'none'");
    expect(fullCsp).toContain("worker-src 'none'");
    expect(fullCsp).toContain('frame-ancestors https://usebaci.com;');

    const composable = createOgabasseyStorefrontManifest();
    composable.mode = 'composable';
    composable.hostOrigin = 'https://shop.ogabassey.com';
    const compCsp = buildContentSecurityPolicyHeader(composable);
    expect(compCsp).toContain(
      'frame-ancestors https://usebaci.com https://ogabassey.usebaci.com https://shop.ogabassey.com;'
    );
  });

  it('classifies vetted vs unvetted CSP origins across directives', () => {
    const summary = summarizeCspGovernance({
      scriptOrigins: ['https://www.googletagmanager.com'],
      connectOrigins: ['https://custom.analytics.example'],
      imgOrigins: ['https://cdn.usebaci.com'],
    });
    expect(summary.vettedOrigins).toEqual([
      'https://cdn.usebaci.com',
      'https://www.googletagmanager.com',
    ]);
    expect(summary.unvettedOrigins).toEqual([
      'https://custom.analytics.example',
    ]);
  });
});
