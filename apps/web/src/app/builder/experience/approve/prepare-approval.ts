import { apiPost } from '@/lib/api-client';
import { experiencePreparationResponse } from '@/schemas/experience-publication';

export async function prepareApprovalUntilReady(input: {
  approvalId: string;
  action: 'prepare-draft' | 'prepare-publication';
  signal: AbortSignal;
  onProgress?(approvalId: string): void;
}) {
  let approvalId = input.approvalId;
  const deadline = Date.now() + 30 * 60_000;
  let delay = 2_000;
  while (Date.now() < deadline) {
    const startedAt = Date.now();
    input.signal.throwIfAborted();
    const result = experiencePreparationResponse.parse(
      await apiPost(
        '/api/builder-experience/approval',
        { action: input.action, approvalId },
        { signal: input.signal }
      )
    );
    delay =
      result.approvalId !== approvalId || Date.now() - startedAt >= 15_000
        ? 2_000
        : Math.min(delay * 2, 20_000);
    approvalId = result.approvalId;
    input.onProgress?.(approvalId);
    if (result.status !== 'preparing') return result;
    // A short delay limits polling when a verifier lane is busy.
    await new Promise<void>((resolve, reject) => {
      if (input.signal.aborted) {
        reject(input.signal.reason);
        return;
      }
      const abort = () => {
        clearTimeout(timer);
        reject(input.signal.reason);
      };
      const timer = setTimeout(() => {
        input.signal.removeEventListener('abort', abort);
        resolve();
      }, delay);
      input.signal.addEventListener('abort', abort, { once: true });
    });
  }
  throw Error('Approval preparation did not complete.');
}
