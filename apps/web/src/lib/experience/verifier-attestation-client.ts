import 'server-only';
import { createHmac, randomBytes } from 'node:crypto';
import { serializeExperienceOwnerWireMessage } from '@/schemas/experience-owner-wire';
import { experienceApprovalId } from '@/schemas/experience-publication';
import type { OwnerLifecycleVerification } from './owner-lifecycle-runtime';
import { VerifierTemporarilyUnavailable } from './verifier-availability';

/** Baci server only. The verifier endpoint is fixed and accepts no browser token. */
export function createVerifierAttestationClient(settings: {
  key: Uint8Array;
  fetch: typeof fetch;
  now?: () => number;
}): OwnerLifecycleVerification['attest'] {
  if (settings.key.length !== 32 || typeof settings.fetch !== 'function')
    throw Error('INVALID_VERIFIER_CONFIG');
  const key = Uint8Array.from(settings.key);
  return async (client, approvalId, kind, signal) => {
    signal?.throwIfAborted();
    const id = experienceApprovalId.parse(approvalId);
    if (kind !== 'draft' && kind !== 'lifecycle')
      throw Error('VERIFIER_UNAVAILABLE');
    const session = await client.auth.getSession();
    const token = session.data.session?.access_token;
    if (
      session.error ||
      !token ||
      token.length > 8192 ||
      !/^[A-Za-z0-9_.-]+$/.test(token)
    )
      throw Error('VERIFIER_UNAVAILABLE');
    const verified = await client.auth.getUser(token);
    if (verified.error || !verified.data.user)
      throw Error('VERIFIER_UNAVAILABLE');
    const body = serializeExperienceOwnerWireMessage('verifier-attest/v1', {
      version: 1,
      nonce: randomBytes(32).toString('hex'),
      expiresAt: (settings.now ?? Date.now)() + 30000,
      accessToken: token,
      approvalId: id,
      kind,
    });
    const signature = createHmac('sha256', key)
      .update(`verifier-attest/v1\n${body}`)
      .digest('hex');
    signal?.throwIfAborted();
    const deadline = AbortSignal.timeout(600000);
    const response = await settings
      .fetch('https://owner.baci-internal.invalid/internal/owner/attest', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-baci-verifier-signature': signature,
        },
        body,
        redirect: 'error',
        cache: 'no-store',
        credentials: 'omit',
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      })
      .catch(() => {
        throw new VerifierTemporarilyUnavailable();
      });
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 429 || response.status >= 500)
      throw new VerifierTemporarilyUnavailable();
    if (response.status !== 204) throw Error('VERIFIER_UNAVAILABLE');
  };
}
