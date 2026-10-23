import { describe, expect, it } from 'vitest';
import { serviceAuthorityGraphFindings } from '../../../tools/events/event-pipeline-service-authority-graph';

const worker = 'apps/web/src/scripts/process-merchant-onboarding-emails.ts';
const zepto = 'apps/web/src/lib/zeptomail.ts';
const sender = 'apps/web/src/lib/merchant-sending-domain.ts';
const admin = 'apps/web/src/lib/supabase/admin.ts';
const service = 'apps/web/src/lib/supabase/service.ts';
const env = 'apps/web/src/env.ts';
function sources(root = worker) {
  return new Map([
    [
      root,
      "import '@/env'; import { createServiceClient } from '@/lib/supabase/service'; import '@/lib/zeptomail'; createServiceClient();",
    ],
    [
      zepto,
      "import '@/env'; import '@/lib/supabase/admin'; import '@/lib/merchant-sending-domain';",
    ],
    [sender, "import '@/lib/supabase/admin';"],
    [admin, "import '@/env'; export const createAdminClient = () => null;"],
    [service, 'export const createServiceClient = () => null;'],
    [env, 'export const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;'],
  ]);
}

function findings(graph: Map<string, string>, root: string) {
  const baseline = new Map(graph);
  baseline.delete(root);
  return serviceAuthorityGraphFindings(graph, [root], baseline);
}

describe('onboarding worker authority', () => {
  it('allows only the background entrypoint and its audited transport paths', () => {
    expect(findings(sources(), worker)).toEqual([]);
  });
  it('does not grant a sibling scheduler the same authority', () => {
    const sibling = 'apps/web/src/scripts/other-onboarding-worker.ts';
    expect(findings(sources(sibling), sibling)).toContain(
      `${sibling}: unauthorized service factory importer`
    );
  });
  it.each([
    [
      'apps/web/src/app/api/merchant/onboarding-reminder/route.ts',
      'export function GET() {}',
    ],
    [
      'apps/web/src/app/dashboard/actions.ts',
      "'use server'; export async function action() {}",
    ],
    [
      'apps/web/src/app/dashboard/reminder/page.tsx',
      "'use client'; export function Rogue() { return null; }",
    ],
  ])('rejects a user-facing importer %s', (root, declaration) => {
    const graph = sources();
    graph.set(
      root,
      `${declaration}\nimport '@/scripts/process-merchant-onboarding-emails';`
    );
    const result = findings(graph, root).join('\n');
    expect(result).toContain('authority');
    expect(result).toContain(root);
    expect(result).toContain(worker);
  });
  it('does not allow the worker to directly construct an admin client', () => {
    const graph = sources();
    graph.set(worker, "import '@/lib/supabase/admin';");
    expect(findings(graph, worker)).toContain(
      `${worker}: unauthorized admin factory importer`
    );
  });
});
