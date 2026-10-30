import { describe, expect, it } from 'vitest';
import { serviceAuthorityGraphFindings } from '../../../tools/events/event-pipeline-service-authority-graph';

const autocomplete = 'apps/web/src/app/api/places/autocomplete/route.ts';
const details = 'apps/web/src/app/api/places/details/route.ts';
const google = 'apps/web/src/app/api/places/google-autocomplete.ts';
const geoapify = 'apps/web/src/app/api/places/geoapify-autocomplete.ts';
const budget = 'apps/web/src/app/api/places/provider-budget.ts';
const reservation = 'apps/web/src/lib/address-budget/reservation.ts';
const client = 'apps/web/src/lib/address-budget/scoped-client.ts';
const signer = 'apps/web/src/lib/supabase/scoped-jwt.ts';
const material = 'apps/web/src/lib/agentic/jwt-signing-material.ts';
const environment = 'apps/web/src/env.ts';
const roots = [
  autocomplete,
  details,
  google,
  geoapify,
  budget,
  reservation,
  client,
];

function sources() {
  return new Map([
    [
      autocomplete,
      "import '../google-autocomplete'; import '../geoapify-autocomplete';",
    ],
    [details, "import '../provider-budget';"],
    [google, "import './provider-budget';"],
    [geoapify, "import './provider-budget';"],
    [budget, "import '@/lib/address-budget/reservation';"],
    [reservation, "import './scoped-client';"],
    [client, "import '@/lib/supabase/scoped-jwt';"],
    [signer, "import '@/lib/agentic/jwt-signing-material';"],
    [material, "import { getSupabaseJwtSecret } from '@/env';"],
    [environment, 'use(process.env.SUPABASE_SERVICE_ROLE_KEY);'],
  ]);
}

describe('address budget scoped signing paths', () => {
  it.each(roots)('permits the exact existing-signer path from %s', (root) => {
    expect(serviceAuthorityGraphFindings(sources(), [root], new Map())).toEqual(
      []
    );
  });

  it.each([
    'apps/web/src/app/api/places/rogue/route.ts',
    'apps/web/src/lib/address-budget/rogue.ts',
  ])('rejects an unlisted consumer %s', (root) => {
    const graph = sources();
    graph.set(root, "import '@/lib/address-budget/reservation';");
    expect(
      serviceAuthorityGraphFindings(graph, [root], new Map()).join('\n')
    ).toContain('credential authority');
  });

  it('rejects direct secret access outside the existing scoped signer', () => {
    const graph = sources();
    graph.set(client, "import { getSupabaseServiceRoleKey } from '@/env';");
    expect(
      serviceAuthorityGraphFindings(graph, roots, new Map()).join('\n')
    ).toContain('credential authority');
  });

  it.each([
    'admin',
    'service',
  ])('does not authorize the %s factory', (factory) => {
    const graph = sources();
    graph.set(client, `import '@/lib/supabase/${factory}';`);
    graph.set(
      `apps/web/src/lib/supabase/${factory}.ts`,
      'export const createClient = () => null;'
    );
    expect(
      serviceAuthorityGraphFindings(graph, roots, new Map()).join('\n')
    ).toContain(`unauthorized ${factory} factory importer`);
  });
});
