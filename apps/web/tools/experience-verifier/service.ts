import { timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Pool } from 'pg';
import { loadDraftApproval } from '@/lib/experience/approval-service';
import { createIndependentApprovalVerifier } from '@/lib/experience/independent-approval-verifier';
import { loadOwnerPreviewBootstrap } from '@/lib/experience/owner-preview-bootstrap';
import { createOwnerPreviewUserClientResolver } from '@/lib/experience/owner-preview-user-client';
import { productionDeliveryOrigins } from '@/lib/experience/production-origins';
import { loadLifecycleApproval } from '@/lib/experience/publication-service';
import { createRunnerExecutor } from '../experience-runner/runner-transport';
import { createApprovalCapture } from './approval-capture';
import { createVerifierApprovalRecorder } from './approval-recorder';
import { createVerifierAttestationHandler } from './attestation-handler';
import { createVerifierBuildHandler } from './build-handler';
import { createVerifierBuildRecorder } from './build-recorder';
import { createIndependentBuildVerifier } from './build-verifier';
import { createVerifierCaptureHandler } from './capture-handler';
import { startVerifierListener } from './listener';
import { createVerifierNonceStore } from './nonce-store';
import { createVerifierWorkerResolver } from './worker-resolver';

/** Trusted process startup. The caller owns the restricted pool and shutdown. */
export async function startVerifierService(settings: {
  pool: Pool;
  key: Uint8Array;
  port: number;
  runner: Parameters<typeof createRunnerExecutor>[0];
  previewOrigin: string;
  executionOrigin: string;
  supabase: { url: string; anonKey: string };
  canonicalBase(slug: string, client: SupabaseClient): string | Promise<string>;
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
  const recordBuild = await createVerifierBuildRecorder(settings.pool);
  const resolveUserClient = createOwnerPreviewUserClientResolver(
    settings.supabase
  );
  const workers = createVerifierWorkerResolver(settings);
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
      const worker = await workers.resolve(
        { supabase: client, merchantId: approval.merchantId },
        approval.buildId
      );
      return createApprovalCapture(worker)(client, binding);
    },
  });
  const handler = createVerifierAttestationHandler({
    key: settings.key,
    consumeNonce,
    resolveUserClient,
    attest: verifier.attest,
  });
  const buildHandler = createVerifierBuildHandler({
    key: settings.key,
    consumeNonce,
    resolveUserClient,
    verify: createIndependentBuildVerifier({
      execute: createRunnerExecutor({ ...settings.runner, lane: 'owner' }),
      bootstrap: loadOwnerPreviewBootstrap,
      canonicalBase: settings.canonicalBase,
      previewOrigin: settings.previewOrigin,
      executionOrigin: settings.executionOrigin,
      record: recordBuild,
    }),
  });
  const captureHandler = createVerifierCaptureHandler({
    key: settings.key,
    consumeNonce,
    resolveUserClient,
    resolveWorker: workers.resolve,
  });
  const listener = await startVerifierListener(
    handler,
    settings.port,
    buildHandler,
    captureHandler
  );
  return {
    async close() {
      await listener.close();
      workers.clear();
    },
  };
}
