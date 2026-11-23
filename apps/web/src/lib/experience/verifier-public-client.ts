import 'server-only';
import { createHmac, randomBytes } from 'node:crypto';
import { experienceApprovalId } from '@/schemas/experience-publication';
import type { OwnerLifecycleVerification } from './owner-lifecycle-runtime';
import { PUBLIC_VERIFICATION_CLIENT_TIMEOUT_MS } from './public-verification-deadline';

/** Sends no caller-selected merchant or receipt data to the independent verifier. */
export function createVerifierPublicClient(settings: {
  key: Uint8Array;
  fetch: typeof fetch;
  now?: () => number;
}): OwnerLifecycleVerification['verifyCommitted'] {
  if (settings.key.length !== 32 || typeof settings.fetch !== 'function')
    throw Error('INVALID_VERIFIER_CONFIG');
  const key = Uint8Array.from(settings.key);
  return async (client, receipt, signal) => {
    signal?.throwIfAborted();
    const approvalId = experienceApprovalId.parse(receipt.approvalId);
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
    const body = JSON.stringify({
      version: 1,
      nonce: randomBytes(32).toString('hex'),
      expiresAt: (settings.now ?? Date.now)() + 30000,
      accessToken: token,
      approvalId,
    });
    const signature = createHmac('sha256', key)
      .update(`verifier-public/v1\n${body}`)
      .digest('hex');
    signal?.throwIfAborted();
    const deadline = AbortSignal.timeout(PUBLIC_VERIFICATION_CLIENT_TIMEOUT_MS);
    const response = await settings.fetch(
      'https://owner.baci-internal.invalid/internal/owner/public',
      {
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
      }
    );
    await response.body?.cancel().catch(() => undefined);
    if (response.status !== 204) throw Error('VERIFIER_UNAVAILABLE');
  };
}
