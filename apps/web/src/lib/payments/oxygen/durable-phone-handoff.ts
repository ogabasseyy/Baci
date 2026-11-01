import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  oxygenPhoneCapabilitySchema,
  oxygenPhoneStoredSchema,
} from '@/schemas/oxygen-phone-handoff';
import { oxygenRuntimeSnapshotSchema } from '@/schemas/oxygen-runtime-view';
import type { OxygenPhoneConfiguration } from './phone-handoff-configuration';
import { decryptPhoneTarget, encryptPhoneTarget } from './phone-handoff-crypto';
import type { OxygenProvider } from './provider';
import { hosted } from './runtime-policy';
import {
  type OxygenRuntimeRpc,
  oxygenRuntimeRpc,
  readOxygenSnapshot,
} from './runtime-service';

const digest = (token: string) =>
  createHash('sha256')
    .update(oxygenPhoneCapabilitySchema.parse(token))
    .digest('hex');
function expiry(url: string) {
  const jwt = new URL(url).searchParams.get('securityToken');
  if (!jwt) return Date.now() + 300000;
  try {
    return (
      z
        .object({ exp: z.number().finite() })
        .parse(
          JSON.parse(
            Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString()
          )
        ).exp * 1000
    );
  } catch {
    return 0;
  }
}
export async function issueDurableOxygenHandoff(
  user: OxygenRuntimeRpc,
  worker: () => Promise<OxygenRuntimeRpc>,
  provider: OxygenProvider,
  partner: string,
  workflowId: string,
  config: OxygenPhoneConfiguration
) {
  const current = await readOxygenSnapshot(user, workflowId);
  if (
    !current.executionEnabled ||
    current.environment !== config.environment ||
    !current.state.validated ||
    !current.state.applicationReference ||
    current.state.bookingReference ||
    current.state.kyc?.selfie_status === 'DONE'
  )
    throw new Error('Phone verification unavailable');
  const scoped = oxygenRuntimeSnapshotSchema.parse(
    await oxygenRuntimeRpc(await worker(), 'worker_status', workflowId)
  );
  if (
    scoped.workflowId !== workflowId ||
    scoped.environment !== config.environment ||
    !scoped.executionEnabled ||
    !scoped.state.validated ||
    scoped.state.applicationReference !== current.state.applicationReference ||
    scoped.state.bookingReference ||
    scoped.state.kyc?.selfie_status === 'DONE'
  )
    throw new Error('Phone verification unavailable');
  let url = scoped.state.selfieUrl;
  if (!url || expiry(url) < Date.now() + 60000) {
    url = z.object({ url: z.string() }).parse(
      await provider.call('selfie', {
        loan_request_reference: scoped.state.applicationReference,
        partner_reference: partner,
      })
    ).url;
  }
  url = hosted(url, config.hosts);
  const expiresAt = Math.min(expiry(url), Date.now() + 299000);
  if (expiresAt <= Date.now() + 1000)
    throw new Error('Phone verification unavailable');
  const token = randomBytes(32).toString('base64url');
  const hash = digest(token);
  const ciphertext = encryptPhoneTarget(url, config.key, {
    hash,
    workflowId,
    applicationReference: current.state.applicationReference,
    environment: config.environment,
  });
  const target = `${config.origin}/auth/oxygen-selfie#${token}`;
  // Lazy server-only PNG encoder: no new checkout browser bundle or third-party QR service.
  const qr = await (await import('qrcode')).toDataURL(target, {
    errorCorrectionLevel: 'M',
    margin: 4,
    width: 320,
  });
  const { data, error } = await user.rpc('oxygen_phone_handoff', {
    p_operation: 'issue',
    p_workflow_id: workflowId,
    p_hash: hash,
    p_payload: {
      applicationReference: current.state.applicationReference,
      ciphertext,
      expiresAt: new Date(expiresAt).toISOString(),
    },
  });
  if (error || !z.object({ stored: z.literal(true) }).safeParse(data).success)
    throw new Error('Phone verification unavailable');
  return { qr, expiresAt };
}
export async function redeemDurableOxygenHandoff(
  worker: OxygenRuntimeRpc,
  token: string,
  config: OxygenPhoneConfiguration
) {
  const hash = digest(token);
  const { data, error } = await worker.rpc('oxygen_phone_handoff', {
    p_operation: 'consume',
    p_workflow_id: null,
    p_hash: hash,
    p_payload: {},
  });
  if (error) throw new Error('Phone verification unavailable');
  const row = oxygenPhoneStoredSchema.parse(data);
  if (
    row.environment !== config.environment ||
    Date.parse(row.expiresAt) <= Date.now() ||
    Date.parse(row.expiresAt) > Date.now() + 300000
  )
    throw new Error('Phone verification unavailable');
  return {
    url: hosted(
      decryptPhoneTarget(row.ciphertext, config.key, { hash, ...row }),
      config.hosts
    ),
  };
}
