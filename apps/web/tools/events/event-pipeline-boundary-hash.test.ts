import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { eventPipelineFrozenRoutes } from '../../src/lib/events/event-pipeline-frozen-authority-sources';
import { frozenRouteHashFinding } from './event-pipeline-boundary-hash';

describe('frozenRouteHashFinding', () => {
  it('accepts reviewed offer validation while rejecting later privileged route drift', () => {
    const path = 'apps/web/src/app/api/orders/route.ts';
    const source = readFileSync(resolve(process.cwd(), '../..', path), 'utf8');
    const receipt = eventPipelineFrozenRoutes[path];

    expect(frozenRouteHashFinding(path, source, receipt)).toBeUndefined();
    expect(
      frozenRouteHashFinding(
        path,
        source.replace(
          "supabase.rpc('get_product_offers'",
          "createAdminClient().rpc('get_product_offers'"
        ),
        receipt
      )
    ).toMatch(
      /^apps\/web\/src\/app\/api\/orders\/route\.ts: frozen route hash /
    );
  });

  it('reports drift and accepts the exact digest', () => {
    const finding = frozenRouteHashFinding('route.ts', 'drift', 'expected');
    expect(finding).toMatch(/^route\.ts: frozen route hash /);
    const digest = finding?.split(' ').at(-1) ?? '';
    expect(frozenRouteHashFinding('route.ts', 'drift', digest)).toBeUndefined();
  });
});
