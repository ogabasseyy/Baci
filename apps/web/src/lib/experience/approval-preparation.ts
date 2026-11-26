import { experiencePreparationIntent } from '@/schemas/experience-publication';
import type { OwnerLifecycleVerification } from './owner-lifecycle-runtime';
import { VerifierTemporarilyUnavailable } from './verifier-availability';

const SLICE_MS = 100_000;
const MIN_CONFIRMATION_MS = 15_000;

export function createApprovalPreparation(
  attest: OwnerLifecycleVerification['attest'],
  kind: 'draft' | 'lifecycle'
) {
  return async (
    client: Parameters<typeof attest>[0],
    id: string,
    signal?: AbortSignal
  ) => {
    signal?.throwIfAborted();
    const query = client.rpc('experience_prepare_approval', {
      p_intent: id,
      p_kind: kind,
    });
    const result = await (signal ? query.abortSignal(signal) : query);
    signal?.throwIfAborted();
    if (result.error) throw Error('APPROVAL_UNAVAILABLE');
    const intent = experiencePreparationIntent.parse(result.data);
    const preparing = {
      approvalId: intent.approvalId,
      status: 'preparing' as const,
    };
    if (intent.status === 'preparing') return preparing;
    if (intent.status !== 'confirmation-required')
      return { approvalId: intent.approvalId, status: 'reconciled' as const };
    if (intent.proofExpiresAt)
      return {
        approvalId: intent.approvalId,
        expiresAt: intent.proofExpiresAt,
        status: 'ready' as const,
      };
    if (!intent.expiresAt || !intent.effectDigest)
      throw Error('APPROVAL_UNAVAILABLE');
    const startedAt = Date.now();
    const remaining = Date.parse(intent.expiresAt) - startedAt;
    if (remaining <= MIN_CONFIRMATION_MS) return preparing;

    const timebox = AbortSignal.timeout(
      Math.min(SLICE_MS, remaining - MIN_CONFIRMATION_MS)
    );
    const work = signal ? AbortSignal.any([signal, timebox]) : timebox;
    try {
      await attest(client, intent.approvalId, kind, work);
      work.throwIfAborted();
    } catch (error) {
      signal?.throwIfAborted();
      if (timebox.aborted || error instanceof VerifierTemporarilyUnavailable)
        return preparing;
      throw error;
    }
    return {
      approvalId: intent.approvalId,
      expiresAt: new Date(
        Math.min(Date.parse(intent.expiresAt), startedAt + 240_000)
      ).toISOString(),
      status: 'ready' as const,
    };
  };
}
