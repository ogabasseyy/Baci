import 'server-only';
import { createHmac, randomBytes } from 'node:crypto';
import { experienceApprovalId } from '@/schemas/experience-publication';
import type { OwnerLifecycleVerification } from './owner-lifecycle-runtime';

/** Sends no caller-selected merchant or receipt data to the independent verifier. */
export function createVerifierPublicClient(settings: {
  key: Uint8Array;
  fetch?: typeof fetch;
  now?: () => number;
}): OwnerLifecycleVerification['verifyCommitted'] {
  if (settings.key.length !== 32) throw Error('INVALID_VERIFIER_CONFIG');
  const key = Uint8Array.from(settings.key);
  return async (client, receipt) => {
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
    const response = await (settings.fetch ?? fetch)(
      'https://mcp.usebaci.com/internal/owner/public',
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
        signal: AbortSignal.timeout(600000),
      }
    );
    await response.body?.cancel().catch(() => undefined);
    if (response.status !== 204) throw Error('VERIFIER_UNAVAILABLE');
  };
}
