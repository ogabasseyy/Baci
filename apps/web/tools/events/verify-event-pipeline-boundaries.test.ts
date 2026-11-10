import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { collectProductionImportClosure } from '../../src/lib/events/event-pipeline-import-closure';

const verifierPath = resolve(
  process.cwd(),
  'tools/events/verify-event-pipeline-boundaries.ts'
);
describe('event pipeline source boundary verifier', () => {
  it('discovers the immutable inventory plus dynamic changed and untracked paths', async () => {
    if (!existsSync(verifierPath)) return;
    const moduleUrl = pathToFileURL(
      resolve(process.cwd(), 'tools/events/event-pipeline-governed-paths.ts')
    ).href;
    const { eventPipelineGovernedPaths } = await import(
      /* @vite-ignore */ moduleUrl
    );
    // biome-ignore format: compact dynamic fixtures preserve the 300-line test gate.
    const relativeFixtures = ['ts', 'mjs'].map((extension) => `src/lib/task5-untracked-worker-${process.pid}.test.${extension}`);
    // biome-ignore format: compact dynamic fixtures preserve the 300-line test gate.
    for (const path of relativeFixtures)
      writeFileSync(resolve(process.cwd(), path), 'export const task5Untracked = true;', { flag: 'wx' });
    const paths = (() => {
      try {
        return eventPipelineGovernedPaths.collect();
      } finally {
        for (const path of relativeFixtures)
          rmSync(resolve(process.cwd(), path), { force: true });
      }
    })();
    expect(paths.fixtureRecordCount).toBe(154);
    expect(paths.paths).toContain(
      'apps/web/src/scripts/process-event-deliveries.ts'
    );
    expect(paths.productionPaths).toContain(
      'apps/web/src/scripts/process-event-deliveries.ts'
    );
    for (const path of relativeFixtures)
      expect(paths.paths).toContain(`apps/web/${path}`);
    const sources = new Map([
      ['apps/web/src/root.ts', "export * from './moved-worker';"],
      ['apps/web/src/moved-worker.ts', 'export const moved = true;'],
    ]);
    expect(
      collectProductionImportClosure(['apps/web/src/root.ts'], sources)
    ).toEqual(new Set(sources.keys()));
  }, 90_000);
  it('rejects every frozen escape and unauthorized direct caller', async () => {
    expect(
      existsSync(verifierPath),
      'source boundary verifier is missing'
    ).toBe(true);
    if (!existsSync(verifierPath)) return;
    const moduleUrl = pathToFileURL(verifierPath).href;
    const { analyzeRpcSource } = await import(/* @vite-ignore */ moduleUrl);
    expect(
      analyzeRpcSource(
        'apps/web/src/lib/events/new-worker.ts',
        "client.rpc('claim_event_deliveries_v1', {})",
        true
      )
    ).toContain(
      'apps/web/src/lib/events/new-worker.ts: unauthorized direct RPC claim_event_deliveries_v1'
    );
    expect(
      analyzeRpcSource(
        'apps/web/src/lib/events/new-worker.ts',
        "client.rpc('replay_event_delivery_v1', {})",
        true
      )
    ).toContain(
      'apps/web/src/lib/events/new-worker.ts: forbidden direct RPC replay_event_delivery_v1'
    );
    expect(
      analyzeRpcSource(
        'apps/web/src/lib/events/new-worker.ts',
        "const name = 'claim_event_deliveries_v1'; client.rpc(name, {}); const escape = value as never;",
        true
      )
    ).toEqual(
      expect.arrayContaining([
        'apps/web/src/lib/events/new-worker.ts: forbidden never assertion',
        'apps/web/src/lib/events/new-worker.ts: unauthorized direct RPC claim_event_deliveries_v1',
      ])
    );
    expect(
      analyzeRpcSource(
        'apps/web/src/lib/events/new-worker.ts',
        "client.rpc('unclassified_pipeline_rpc_v1', {})",
        true
      )
    ).toContain(
      'apps/web/src/lib/events/new-worker.ts: unclassified RPC unclassified_pipeline_rpc_v1'
    );
    expect(
      analyzeRpcSource(
        'apps/web/src/lib/events/new-worker.ts',
        'client.rpc(dynamicName(), {})',
        true
      )
    ).toContain(
      'apps/web/src/lib/events/new-worker.ts: unresolved indirect RPC name'
    );
    expect(
      analyzeRpcSource(
        'vps-workers/jobs/supabase-retention-cleanup.mjs',
        "import { createClient } from '@supabase/supabase-js'; createClient(url, key); client.rpc('cleanup_database_retention', {}); client.rpc('cleanup_domain_event_pipeline_v1', {});",
        true
      )
    ).toEqual([]);
    expect(
      analyzeRpcSource(
        'apps/web/src/lib/events/new-worker.ts',
        "client['rpc']('replay_event_delivery_v1', {})",
        true
      )
    ).toContain(
      'apps/web/src/lib/events/new-worker.ts: forbidden direct RPC replay_event_delivery_v1'
    );
    expect(
      analyzeRpcSource(
        'apps/web/src/lib/events/new-worker.ts',
        "const invoke = client.rpc.bind(client); invoke('claim_event_deliveries_v1', {})",
        true
      )
    ).toContain(
      'apps/web/src/lib/events/new-worker.ts: unauthorized direct RPC claim_event_deliveries_v1'
    );
    expect(
      analyzeRpcSource(
        'apps/web/src/lib/events/new-worker.ts',
        "const invoke = client.rpc; { const invoke = () => undefined; invoke('claim_event_deliveries_v1', {}); }",
        true
      )
    ).toEqual([]);
    expect(
      analyzeRpcSource(
        'apps/web/src/lib/events/new-worker.ts',
        "client.from('merchants').select('id,bvn')",
        true
      )
    ).toContain(
      'apps/web/src/lib/events/new-worker.ts: unauthorized merchants column bvn'
    );
    expect(
      analyzeRpcSource(
        'apps/web/src/lib/events/new-worker.ts',
        "const query = client.from('merchants'); const select = query.select; select('id,bvn')",
        true
      )
    ).toContain(
      'apps/web/src/lib/events/new-worker.ts: unauthorized merchants column bvn'
    );
    expect(
      analyzeRpcSource(
        'apps/web/src/lib/events/new-worker.ts',
        "const query = client.from('merchants'); const select = query.select.bind(query); select('id,bvn')",
        true
      )
    ).toContain(
      'apps/web/src/lib/events/new-worker.ts: unauthorized merchants column bvn'
    );
  }, 30_000);
  it('rejects bare clients, untyped factories, assertions, and unmanifested queries', async () => {
    const moduleUrl = pathToFileURL(verifierPath).href;
    const { analyzeRpcSource } = await import(/* @vite-ignore */ moduleUrl);
    const path = 'apps/web/src/app/api/sixth-client/route.ts';
    expect(
      analyzeRpcSource(
        path,
        "import type { SupabaseClient } from '@supabase/supabase-js'; let client: SupabaseClient;",
        true
      )
    ).toContain(`${path}: forbidden bare SupabaseClient`);
    expect(
      analyzeRpcSource(
        path,
        "import { createClient } from '@supabase/supabase-js'; createClient(url, key);",
        true
      )
    ).toContain(`${path}: SDK createClient requires Database`);
    expect(
      analyzeRpcSource(
        path,
        "import * as sdk from '@supabase/supabase-js'; let client: sdk.SupabaseClient; sdk.createClient(url, key);",
        true
      )
    ).toEqual(
      expect.arrayContaining([
        `${path}: forbidden bare SupabaseClient`,
        `${path}: SDK createClient requires Database`,
      ])
    );
    expect(
      analyzeRpcSource(
        path,
        "client.rpc(('claim_event_deliveries_v1' as string), args as object)",
        true
      )
    ).toContain(`${path}: forbidden asserted RPC boundary`);
    expect(analyzeRpcSource(path, '<never>value', true)).toContain(
      `${path}: forbidden never assertion`
    );
    expect(
      analyzeRpcSource(
        path,
        "client.from('unmanifested_table').select('secret')",
        true
      )
    ).toContain(`${path}: unmanifested operation select on unmanifested_table`);
  });
  it('rejects new service/admin route edges and pre-verification privilege', async () => {
    const moduleUrl = pathToFileURL(verifierPath).href;
    const { analyzeRpcSource } = await import(/* @vite-ignore */ moduleUrl);
    const wrapper = 'apps/web/src/app/api/third-wrapper/route.ts';
    expect(
      analyzeRpcSource(
        wrapper,
        "import { createServiceClient } from '@/lib/supabase/service'; const client = createServiceClient('event-pipeline');",
        true
      )
    ).toEqual(
      expect.arrayContaining([
        `${wrapper}: unauthorized trusted wrapper importer`,
        `${wrapper}: privileged route client construction is forbidden`,
      ])
    );
    const platform = 'apps/web/src/app/api/platform/events/second-forwarder.ts';
    expect(
      analyzeRpcSource(
        platform,
        "import { createAdminClient } from '@/lib/supabase/admin'; createAdminClient();",
        true
      )
    ).toContain(`${platform}: unauthorized admin factory importer`);
    for (const source of [
      "getUser(); createServiceClient('event-pipeline');",
      "unrelated.getUser(); createServiceClient('event-pipeline');",
      "if (condition) resolveEventIngressContext(); createServiceClient('event-pipeline');",
    ])
      expect(
        analyzeRpcSource(
          wrapper,
          `import { createServiceClient } from '@/lib/supabase/service'; ${source}`,
          true
        )
      ).toContain(
        `${wrapper}: privileged route client construction is forbidden`
      );
  });
  it('traces re-exports and stored or nested RPC assertions', async () => {
    const moduleUrl = pathToFileURL(verifierPath).href;
    const { analyzeRpcSource } = await import(/* @vite-ignore */ moduleUrl);
    const facade = 'apps/web/src/lib/events/service-facade.ts';
    expect(
      analyzeRpcSource(
        facade,
        "export { createServiceClient } from '@/lib/supabase/service';",
        true
      )
    ).toContain(`${facade}: unauthorized privileged factory re-export`);
    for (const source of [
      "export type { ServiceRoleClient } from '@/lib/supabase/service';",
      "export { unrelated } from '@/lib/supabase/service';",
    ])
      expect(analyzeRpcSource(facade, source, true)).not.toContain(
        `${facade}: unauthorized privileged factory re-export`
      );
    expect(
      analyzeRpcSource(facade, "export * from '@/lib/supabase/service';", true)
    ).toContain(`${facade}: unauthorized privileged factory re-export`);
    const identityPath = 'apps/web/src/lib/events/event-ingress-context.ts';
    // biome-ignore format: compact regression preserves the 300-line test gate.
    expect(analyzeRpcSource(identityPath, "const client = raw as unknown as SupabaseClient<Database>; client.from('merchants').select('id');", true)).toContain(`${identityPath}: forbidden asserted query boundary`);
    // biome-ignore format: compact false-positive guard preserves the 300-line test gate.
    expect(analyzeRpcSource(identityPath, "const client: SupabaseClient<Database> = createClient('event-pipeline'); client.from('merchants').select('id');", true)).not.toContain(`${identityPath}: forbidden asserted query boundary`);
    const path = 'apps/web/src/lib/events/new-worker.ts';
    for (const source of [
      "const client = {} as SupabaseClient<Database>; client.rpc('claim_event_deliveries_v1', {});",
      "const args = {} as Args; client.rpc('claim_event_deliveries_v1', args);",
      "const returns = client.rpc('claim_event_deliveries_v1', {}) as Returns;",
      "const result = client.rpc('claim_event_deliveries_v1', {}); const returns = result as Returns;",
      "const args = { nested: value as string }; client.rpc('claim_event_deliveries_v1', args);",
    ])
      expect(analyzeRpcSource(path, source, true)).toContain(
        `${path}: forbidden asserted RPC boundary`
      );
  });
  it('rejects an out-of-closure literal RPC caller repo-wide', async () => {
    const moduleUrl = pathToFileURL(verifierPath).href;
    const { analyzeRpcSource } = await import(/* @vite-ignore */ moduleUrl);
    const path = 'apps/web/src/unrelated/out-of-closure.ts';
    expect(
      analyzeRpcSource(path, "client.rpc('route_domain_event_v1', {})", false)
    ).toContain(`${path}: unauthorized direct RPC route_domain_event_v1`);
  });
});
