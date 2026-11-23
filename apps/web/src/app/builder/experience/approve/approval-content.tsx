import {
  ApprovalExpired,
  loadDraftApproval,
} from '@/lib/experience/approval-service';
import { getConfiguredOwnerApproval } from '@/lib/experience/owner-approval-web-config';
import { getExperienceOwnerRuntime } from '@/lib/experience/owner-runtime';
import { loadLifecycleApproval } from '@/lib/experience/publication-service';
import { createClient } from '@/lib/supabase/server';
import {
  experienceApprovalId,
  experienceApprovalPageInput,
} from '@/schemas/experience-publication';
import { experienceDigest } from '@/schemas/experience-upload';
import {
  ExperienceApprovalClient,
  type ExperienceApprovalView,
} from './approval-client';
import { ExperiencePreparationRecovery } from './preparation-recovery';
import { ExperienceVerificationRetry } from './verification-retry';
export async function ExperienceApprovalContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const p = experienceApprovalPageInput.safeParse(await searchParams);
  if (!p.success)
    return (
      <main>
        <h1>Approval unavailable</h1>
        <p>Request a fresh exact-build approval.</p>
      </main>
    );
  const runtime =
    getExperienceOwnerRuntime()?.approval ??
    (p.data.kind === 'draft' ? getConfiguredOwnerApproval() : undefined);
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
          {p.data.kind === 'lifecycle' &&
          data.status === 'verifying' &&
          getExperienceOwnerRuntime()?.approval ? (
            <ExperienceVerificationRetry approvalId={p.data.approval} />
          ) : null}
        </main>
      );
    const action =
      'action' in data && typeof data.action === 'string'
        ? data.action
        : 'apply';
    const view: ExperienceApprovalView = {
      approvalId: p.data.approval,
      merchantId: experienceApprovalId.parse(data.merchantId),
      kind: p.data.kind,
      action,
      buildId: typeof data.buildId === 'string' ? data.buildId : undefined,
      effectDigest: experienceDigest.parse(data.effectDigest),
      routes: 'routes' in data ? data.routes : undefined,
      capabilities: 'capabilities' in data ? data.capabilities : undefined,
      summary: 'summary' in data ? data.summary : data,
      enabled: Boolean(runtime),
      needsPreparation: Boolean(
        p.data.kind === 'draft'
          ? runtime?.prepareDraft
          : (action === 'publish' || action === 'rollback') &&
              runtime?.preparePublication
      ),
    };
    return <ExperienceApprovalClient view={view} />;
  } catch (error) {
    if (
      error instanceof ApprovalExpired &&
      (p.data.kind === 'draft'
        ? runtime?.prepareDraft
        : runtime?.preparePublication)
    ) {
      return (
        <ExperiencePreparationRecovery
          approvalId={p.data.approval}
          kind={p.data.kind}
        />
      );
    }
    return (
      <main>
        <h1>Approval unavailable</h1>
        <p>Sign in as the owner or request a fresh approval.</p>
      </main>
    );
  }
}
