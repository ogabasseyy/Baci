import 'server-only';
import { z } from 'zod';
import { oxygenRuntimeSnapshotSchema } from '@/schemas/oxygen-runtime-view';
import type { OxygenProvider } from './provider';
import { hosted } from './runtime-policy';
import {
  type OxygenRuntimeRpc,
  oxygenRuntimeRpc,
  readOxygenSnapshot,
} from './runtime-service';

const hosts = new Set(['staging.d1l1k5yxed9cvn.amplifyapp.com']);
function expiresAt(url: string): number {
  try {
    const jwt = new URL(url).searchParams.get('securityToken') ?? '';
    const value: unknown = JSON.parse(
      Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString()
    );
    return z.object({ exp: z.number() }).parse(value).exp;
  } catch {
    return 0;
  }
}
/** Local staging bridge only. Production needs a deployed, durable handoff store. */
export async function issueOxygenPhoneHandoff(
  user: OxygenRuntimeRpc,
  workerClient: () => Promise<OxygenRuntimeRpc>,
  provider: OxygenProvider,
  partnerReference: string,
  workflowId: string,
  fetchImpl: typeof fetch = fetch
) {
  const current = await readOxygenSnapshot(user, workflowId);
  if (
    !current.executionEnabled ||
    !current.state.validated ||
    !current.state.applicationReference ||
    current.state.bookingReference
  )
    throw new Error('Unavailable');
  const ready = await fetchImpl('http://127.0.0.1:3456/ready', {
    cache: 'no-store',
    signal: AbortSignal.timeout(3000),
  });
  if (
    !ready.ok ||
    !z.object({ ready: z.boolean() }).parse(await ready.json()).ready
  )
    throw new Error('Unavailable');
  const scoped = oxygenRuntimeSnapshotSchema.parse(
    await oxygenRuntimeRpc(await workerClient(), 'worker_status', workflowId)
  );
  if (
    !scoped.executionEnabled ||
    scoped.workflowId !== current.workflowId ||
    scoped.state.applicationReference !== current.state.applicationReference ||
    !scoped.state.validated ||
    scoped.state.bookingReference
  )
    throw new Error('Unavailable');
  let url = scoped.state.selfieUrl;
  if (!url || expiresAt(url) < Date.now() / 1000 + 60) {
    // One explicit handoff request may renew only the selfie URL, never NIN or OTP.
    url = z.object({ url: z.string() }).parse(
      await provider.call('selfie', {
        loan_request_reference: scoped.state.applicationReference,
        partner_reference: partnerReference,
      })
    ).url;
  }
  url = hosted(url, hosts);
  const expires = Math.min(expiresAt(url), Date.now() / 1000 + 300);
  const response = await fetchImpl('http://127.0.0.1:3456/issue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, expires }),
    signal: AbortSignal.timeout(5000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Unavailable');
  return z
    .object({
      qr: z.string().startsWith('data:image/png;base64,').max(100000),
      expiresAt: z.number().positive(),
    })
    .strict()
    .parse(await response.json());
}
