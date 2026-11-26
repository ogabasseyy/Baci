import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { PublicBootstrap } from '@baci/shared/experience';
import { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import { expect, vi } from 'vitest';
import { z } from 'zod';

import { POST as previewPost } from '@/app/api/builder-experience/preview/route';
import { confirmDraftApply } from '@/lib/experience/approval-service';
import { createIndependentApprovalVerifier } from '@/lib/experience/independent-approval-verifier';
import { installRemoteOwnerPreview } from '@/lib/experience/owner-preview-remote-runtime';
import { createPreviewLaunch } from '@/lib/experience/preview-launch';
import { createPreviewVault } from '@/lib/experience/preview-service';
import { serializeExperienceOwnerWireMessage } from '@/schemas/experience-owner-wire';
import { experienceApprovalRef } from '@/schemas/experience-publication';
import type { createLocalPrerenderArtifacts } from '../../tools/experience-runner/prerender-artifacts';
import { createProductionPreviewDelivery } from '../../tools/experience-runner/preview-delivery';
import type { createRunnerExecutor } from '../../tools/experience-runner/runner-transport';
import { createApprovalCapture } from '../../tools/experience-verifier/approval-capture';
import { createVerifierApprovalRecorder } from '../../tools/experience-verifier/approval-recorder';
import { createVerifierAttestationHandler } from '../../tools/experience-verifier/attestation-handler';
import { createVerifierCaptureWorker } from '../../tools/experience-verifier/capture-worker';
import { createVerifierNonceStore } from '../../tools/experience-verifier/nonce-store';
import type { experienceDataFixture } from './data-fixture.test-support';
import type { startMcpRunnerFixture } from './mcp-runner.test-support';
import { confirmSyntheticDraft } from './owner-approval-loopback.test-support';
import { launchThroughOwnerBridge } from './production-preview-bridge.test-support';
import type { setupBuildVerification } from './verifier-build-loopback.test-support';
import { sendVerifierTwice } from './verifier-loopback.test-support';

export async function checkProductionRunnerPreview(input: {
  f: Awaited<ReturnType<typeof experienceDataFixture>>;
  mcp: Awaited<ReturnType<typeof startMcpRunnerFixture>>;
  buildId: string;
  buildVerification: Awaited<ReturnType<typeof setupBuildVerification>>;
  capture: Awaited<ReturnType<typeof createVerifierCaptureWorker>>;
  verifierPool: Pool;
  verifierKey: Uint8Array;
  key: Uint8Array;
  toolchainDigest: string;
  bootstrap: PublicBootstrap;
  artifacts: ReturnType<typeof createLocalPrerenderArtifacts>;
  execute: ReturnType<typeof createRunnerExecutor>;
  hostOrigin: string;
  previewOrigin: string;
  executionOrigin: string;
  setWebClient(client: unknown): void;
}) {
  const {
    f,
    mcp,
    buildId,
    buildVerification,
    capture,
    verifierPool,
    verifierKey,
    key,
    toolchainDigest,
    bootstrap,
    artifacts,
    execute,
    hostOrigin,
    previewOrigin,
    executionOrigin,
    setWebClient,
  } = input;
  const captureInput = {
    buildId,
    routeId: 'home',
    idempotencyKey: randomUUID(),
  };
  const captured = await buildVerification.capture(
    buildVerification.ctx,
    captureInput
  );
  const replayFetch = vi.fn<typeof fetch>();
  const restartedCapture = await createVerifierCaptureWorker({
    pool: verifierPool,
    hostOrigin,
    previewOrigin,
    bootstrap: async () => bootstrap,
    runner: {
      endpoint: 'https://runner.baci-offline.invalid/v1/execute',
      key,
      toolchainDigest,
      fetch: replayFetch,
    },
  });
  expect(await restartedCapture(f.owner, captureInput)).toEqual(captured);
  await expect(
    restartedCapture(f.owner, { ...captureInput, routeId: '/' })
  ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  expect(replayFetch).not.toHaveBeenCalled();
  const snapshot = await f.owner.supabase
    .from('experience_snapshots')
    .select('id,build_id')
    .eq('id', captured.evidenceId)
    .maybeSingle();
  expect(snapshot.error).toBeNull();
  expect(snapshot.data?.build_id).toBe(buildId);
  const approvalResponse = await mcp.call('apply_experience', {
    storefrontId: f.merchantId,
    buildId,
    evidenceId: captured.evidenceId,
    expectedVersion: 0,
    idempotencyKey: randomUUID(),
  });
  const approval = z
    .object({ status: z.literal('ok'), value: experienceApprovalRef })
    .parse(approvalResponse).value;
  // An MCP request creates an intent, not a committed draft or verifier proof.
  await expect(
    confirmDraftApply(f.owner.supabase, approval.approvalId)
  ).rejects.toThrow('CONFIRMATION_UNAVAILABLE');
  const verifier = createIndependentApprovalVerifier({
    capture: createApprovalCapture(capture),
    record: await createVerifierApprovalRecorder(verifierPool),
    verifyPublic: () => Promise.reject(Error('NOT_AVAILABLE_IN_LOCAL_TEST')),
  });
  const verifierHandler = createVerifierAttestationHandler({
    key: verifierKey,
    consumeNonce: await createVerifierNonceStore(verifierPool),
    resolveUserClient: (token) =>
      token === f.owner.accessToken
        ? Promise.resolve(f.owner.supabase)
        : Promise.reject(Error('INVALID_TOKEN')),
    attest: verifier.attest,
  });
  const payload = serializeExperienceOwnerWireMessage('verifier-attest/v1', {
    version: 1,
    nonce: randomBytes(32).toString('hex'),
    expiresAt: Date.now() + 60000,
    accessToken: f.owner.accessToken,
    approvalId: approval.approvalId,
    kind: 'draft',
  });
  const signature = createHmac('sha256', verifierKey)
    .update(`verifier-attest/v1\n${payload}`)
    .digest('hex');
  expect(await sendVerifierTwice(verifierHandler, payload, signature)).toEqual([
    204, 409,
  ]);
  const proof = await f.db.pool.query(
    'SELECT effect_digest FROM experience_authorization.approval_checks WHERE intent_id=$1',
    [approval.approvalId]
  );
  expect(proof.rows).toEqual([{ effect_digest: approval.effectDigest }]);
  setWebClient(f.owner.supabase);
  try {
    const applied = await confirmSyntheticDraft({
      handler: verifierHandler,
      key: verifierKey,
      client: f.owner.supabase,
      token: f.owner.accessToken,
      approvalId: approval.approvalId,
    });
    expect(applied).toMatchObject({ buildId, version: 1 });
  } finally {
    setWebClient(undefined);
  }

  const vault = createPreviewVault({
    origin: executionOrigin,
    now: Date.now,
    isActive: async (binding) => {
      const result = await f.anonymous.rpc(
        'experience_preview_binding_active',
        { p_binding: binding }
      );
      return !result.error && result.data === true;
    },
  });
  const prerender = {
    artifacts,
    execute,
    executionOrigin,
    bootstrap: async () => bootstrap,
  };
  await expect(
    createPreviewLaunch(
      f.other,
      { buildId, routeId: 'home' },
      vault,
      hostOrigin,
      prerender
    )
  ).rejects.toThrow('NOT_FOUND');
  const launch = await launchThroughOwnerBridge({
    fixture: f,
    vault,
    hostOrigin,
    previewOrigin,
    buildId,
    prerender,
    viaWeb: async (client) => {
      setWebClient(f.owner.supabase);
      const uninstall = installRemoteOwnerPreview(client);
      try {
        const response = await previewPost(
          new NextRequest(
            'https://usebaci.com/api/builder-experience/preview',
            {
              method: 'POST',
              body: JSON.stringify({
                merchantId: f.merchantId,
                buildId,
                routeId: 'home',
              }),
            }
          )
        );
        expect(response.status).toBe(200);
        return await response.json();
      } finally {
        uninstall();
        setWebClient(undefined);
      }
    },
  });
  const delivery = createProductionPreviewDelivery({
    vault,
    executionOrigin,
    hostOrigins: [hostOrigin],
  });
  expect(
    (
      await f.anonymous
        .from('experience_preview_bindings')
        .select('id')
        .limit(1)
    ).error
  ).not.toBeNull();
  const html = await delivery(new Request(launch.src));
  expect(html.status).toBe(200);
  expect(await html.text()).toContain('Synthetic Orbit production ports');
  await f.db.pool.query('DELETE FROM auth.sessions WHERE id=$1', [f.sessionId]);
  expect((await delivery(new Request(launch.src))).status).toBe(404);
  expect(
    (await f.db.pool.query('SELECT count(*) FROM experience_published_heads'))
      .rows[0].count
  ).toBe('0');
}
