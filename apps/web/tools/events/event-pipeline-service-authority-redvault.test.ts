import { describe, expect, it } from 'vitest';
import { serviceAuthorityGraphFindings } from './event-pipeline-service-authority-graph';

const route = 'apps/web/src/app/api/payments/initialize/route.ts';
const initializer =
  'apps/web/src/lib/payments/initialize-redvault-paystack-checkout.ts';
const context = 'apps/web/src/lib/payments/redvault-payment-attempt-client.ts';
const signer = 'apps/web/src/lib/supabase/scoped-jwt.ts';
const material = 'apps/web/src/lib/agentic/jwt-signing-material.ts';
const environment = 'apps/web/src/env.ts';

function sourceGraph(independentHelpers = false) {
  const directive = independentHelpers ? "'use server'; " : '';
  return new Map([
    [route, "import '@/lib/payments/initialize-redvault-paystack-checkout';"],
    [
      initializer,
      `${directive}import '@/lib/payments/redvault-payment-attempt-client';`,
    ],
    [context, `${directive}import '@/lib/supabase/scoped-jwt';`],
    [signer, "import '@/lib/agentic/jwt-signing-material';"],
    [material, "import { getSupabaseServiceRoleKey } from '@/env';"],
    [environment, 'use(process.env.SUPABASE_SERVICE_ROLE_KEY);'],
  ]);
}

describe('REDVAULT scoped credential authority', () => {
  it.each([
    route,
    initializer,
    context,
  ])('allows the reviewed path from %s', (root) => {
    expect(serviceAuthorityGraphFindings(sourceGraph(true), [root])).toEqual(
      []
    );
  });

  it('rejects a sibling route importing the approved initializer', () => {
    const sources = sourceGraph();
    const sibling = 'apps/web/src/app/api/payments/other/route.ts';
    sources.set(
      sibling,
      "import '@/lib/payments/initialize-redvault-paystack-checkout';"
    );
    expect(
      serviceAuthorityGraphFindings(sources, [sibling]).join('\n')
    ).toContain(`${sibling}: API import graph reaches credential authority`);
  });

  it('rejects a shortcut from initialize directly to the context signer', () => {
    const sources = sourceGraph();
    sources.set(
      route,
      "import '@/lib/payments/redvault-payment-attempt-client';"
    );
    expect(
      serviceAuthorityGraphFindings(sources, [route]).join('\n')
    ).toContain(`${route}: API import graph reaches credential authority`);
  });

  it('does not authorize a service-role factory in the context helper', () => {
    const sources = sourceGraph();
    sources.set(
      context,
      "import { createServiceClient } from '@/lib/supabase/service';"
    );
    sources.set(
      'apps/web/src/lib/supabase/service.ts',
      'export const createServiceClient = () => null;'
    );
    expect(
      serviceAuthorityGraphFindings(sources, [route]).join('\n')
    ).toContain('unauthorized service factory importer');
  });
});
