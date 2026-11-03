import { z } from 'zod';
import { loadDraftApproval } from '@/lib/experience/approval-service';
import { getExperienceOwnerRuntime } from '@/lib/experience/owner-runtime';
import { loadLifecycleApproval } from '@/lib/experience/publication-service';
import { createClient } from '@/lib/supabase/server';
import {
  ExperienceApprovalClient,
  type ExperienceApprovalView,
} from './approval-client';
export async function ExperienceApprovalContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const p = z
    .object({
      approval: z.uuid(),
      kind: z.enum(['draft', 'lifecycle']).default('draft'),
    })
    .safeParse(await searchParams);
  if (!p.success)
    return (
      <main>
        <h1>Approval unavailable</h1>
        <p>Request a fresh exact-build approval.</p>
      </main>
    );
  try {
    const client = await createClient();
    const data =
      p.data.kind === 'draft'
        ? await loadDraftApproval(client, p.data.approval)
        : await loadLifecycleApproval(client, p.data.approval);
    if (data.status !== 'confirmation-required')
      return (
        <main>
          <h1>Experience receipt</h1>
          <pre>{JSON.stringify(data, null, 2)}</pre>
        </main>
      );
    const view: ExperienceApprovalView = {
      approvalId: p.data.approval,
      merchantId: z.uuid().parse(data.merchantId),
      kind: p.data.kind,
      action:
        'action' in data && typeof data.action === 'string'
          ? data.action
          : 'apply',
      buildId: typeof data.buildId === 'string' ? data.buildId : undefined,
      effectDigest: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(data.effectDigest),
      routes: 'routes' in data ? data.routes : undefined,
      capabilities: 'capabilities' in data ? data.capabilities : undefined,
      summary: 'summary' in data ? data.summary : data,
      enabled: !!getExperienceOwnerRuntime()?.approval,
    };
    return <ExperienceApprovalClient view={view} />;
  } catch {
    return (
      <main>
        <h1>Approval unavailable</h1>
        <p>Sign in as the owner or request a fresh approval.</p>
      </main>
    );
  }
}
