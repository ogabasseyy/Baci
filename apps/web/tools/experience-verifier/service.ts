import { timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { loadDraftApproval } from '@/lib/experience/approval-service';
import { createIndependentApprovalVerifier } from '@/lib/experience/independent-approval-verifier';
import { loadOwnerPreviewBootstrap } from '@/lib/experience/owner-preview-bootstrap';
import { createOwnerPreviewUserClientResolver } from '@/lib/experience/owner-preview-user-client';
import { productionDeliveryOrigins } from '@/lib/experience/production-origins';
import { loadLifecycleApproval } from '@/lib/experience/publication-service';
import type { createRunnerExecutor } from '../experience-runner/runner-transport';
import { createApprovalCapture } from './approval-capture';
import { createVerifierApprovalRecorder } from './approval-recorder';
import { createVerifierAttestationHandler } from './attestation-handler';
import { createVerifierCaptureWorker } from './capture-worker';
import { startVerifierListener } from './listener';
import { createVerifierNonceStore } from './nonce-store';

/** Trusted process startup. The caller owns the restricted pool and shutdown. */
export async function startVerifierService(settings: {
  pool: Pool;
  key: Uint8Array;
  port: number;
  runner: Parameters<typeof createRunnerExecutor>[0];
  previewOrigin: string;
  executionOrigin: string;
  supabase: { url: string; anonKey: string };
  canonicalBase(slug: string): string;
}) {
  if (
    settings.key.length !== 32 ||
    settings.runner.key.length < 32 ||
    (settings.runner.key.length === 32 &&
      timingSafeEqual(settings.key, settings.runner.key)) ||
    !Number.isInteger(settings.port) ||
    settings.port < 1 ||
    settings.port > 65535
  )
    throw Error('INVALID_VERIFIER_CONFIG');
  productionDeliveryOrigins({
    executionOrigin: settings.executionOrigin,
    hostOrigins: [settings.previewOrigin],
  });
  const consumeNonce = await createVerifierNonceStore(settings.pool);
  const record = await createVerifierApprovalRecorder(settings.pool);
  const resolveUserClient = createOwnerPreviewUserClientResolver(
    settings.supabase
  );
  const workers = new Map<
    string,
    Awaited<ReturnType<typeof createVerifierCaptureWorker>>
  >();
  const verifier = createIndependentApprovalVerifier({
    record,
    verifyPublic: () => Promise.reject(Error('PUBLIC_VERIFIER_NOT_INSTALLED')),
    capture: async (client, binding) => {
      const approval =
        binding.kind === 'draft'
          ? await loadDraftApproval(client, binding.approvalId)
          : await loadLifecycleApproval(client, binding.approvalId);
      if (
        approval.status !== 'confirmation-required' ||
        approval.approvalId !== binding.approvalId ||
        approval.effectDigest !== binding.effectDigest ||
        typeof approval.merchantId !== 'string' ||
        typeof approval.buildId !== 'string' ||
        approval.buildId !== binding.buildId
      )
        throw Error('APPROVAL_MISMATCH');
      const merchant = await client
        .from('merchants')
        .select('slug')
        .eq('id', approval.merchantId)
        .maybeSingle();
      const build = await client
        .from('experience_builds')
        .select('host_origin')
        .eq('merchant_id', approval.merchantId)
        .eq('id', approval.buildId)
        .maybeSingle();
      const slug = merchant.data?.slug;
      if (
        merchant.error ||
        build.error ||
        typeof slug !== 'string' ||
        !/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug) ||
        !build.data
      )
        throw Error('APPROVAL_MISMATCH');
      const canonical = new URL(settings.canonicalBase(slug));
      if (
        canonical.username ||
        canonical.password ||
        canonical.search ||
        canonical.hash
      )
        throw Error('INVALID_VERIFIER_CONFIG');
      productionDeliveryOrigins({
        executionOrigin: settings.executionOrigin,
        hostOrigins: [canonical.origin, settings.previewOrigin],
      });
      if (build.data.host_origin !== canonical.origin)
        throw Error('APPROVAL_MISMATCH');
      const cacheKey = JSON.stringify([approval.merchantId, canonical.origin]);
      let worker = workers.get(cacheKey);
      if (!worker) {
        worker = await createVerifierCaptureWorker({
          pool: settings.pool,
          hostOrigin: canonical.origin,
          previewOrigin: settings.previewOrigin,
          bootstrap: loadOwnerPreviewBootstrap,
          runner: settings.runner,
        });
        if (workers.size >= 32) {
          const oldest = workers.keys().next().value;
          if (oldest) workers.delete(oldest);
        }
        workers.set(cacheKey, worker);
      }
      return createApprovalCapture(worker)(client, binding);
    },
  });
  const handler = createVerifierAttestationHandler({
    key: settings.key,
    consumeNonce,
    resolveUserClient,
    attest: verifier.attest,
  });
  const listener = await startVerifierListener(handler, settings.port);
  return {
    async close() {
      await listener.close();
      workers.clear();
    },
  };
}
