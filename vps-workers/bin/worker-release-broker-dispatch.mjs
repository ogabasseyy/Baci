#!/usr/bin/env node
/** Root-owned, fixed Node entrypoint called only by worker_release_broker.py. */
import { authorizeBrokerRequest } from '../lib/worker-release-broker.mjs';

const MAX_REQUEST_BYTES = 24 * 1024;

async function readRequest() {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > MAX_REQUEST_BYTES) throw new Error('request too large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.endsWith('\n') || raw.indexOf('\n') !== raw.length - 1) throw new Error('invalid request framing');
  return JSON.parse(raw.slice(0, -1));
}

try {
  const peerUid = Number(process.env.BACI_BROKER_PEER_UID);
  const expectedReleaseUid = Number(process.env.BACI_BROKER_RELEASE_UID);
  const workerUid = Number(process.env.BACI_BROKER_WORKER_UID);
  const request = await readRequest();
  if (!Number.isSafeInteger(peerUid) || !Number.isSafeInteger(expectedReleaseUid) ||
      !Number.isSafeInteger(workerUid) || peerUid !== expectedReleaseUid ||
      process.env.BACI_BROKER_AUTHENTICATED_PEER !== 'kernel') {
    throw new Error('trusted peer context unavailable');
  }
  const result = await authorizeBrokerRequest({ peerUid, expectedReleaseUid, workerUid, request });
  process.stdout.write(JSON.stringify({
    operation: result.operation,
    sourceSha: result.sourceSha,
    repository: result.repository,
    workflow: result.workflow,
    ref: result.ref,
    status: result.status,
    runId: result.runId,
    runAttempt: result.runAttempt,
    jobId: result.jobId,
    ...(result.operation === 'readiness' ? {
      installedSha: result.installedSha,
      ready: result.ready,
      units: result.units,
    } : {}),
    ...(result.operation === 'gigl-capability' ? {
      smokePassed: result.smokePassed,
      latched: result.latched,
      scope: result.scope,
      installedSha: result.installedSha,
      latchedSha: result.latchedSha,
    } : {}),
    ...(result.operation === 'recover' ? { recoveryOf: result.recoveryOf } : {}),
    ...(result.operation === 'stage' ? {
      archiveSha256: result.bundleSha256,
      archiveBase64: result.sourceArchive.toString('base64'),
    } : {}),
  }) + '\n');
} catch {
  // Never echo request fields, credentials, or upstream response bodies.
  process.exitCode = 1;
}
